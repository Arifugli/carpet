-- Read-only work queues and customer cards. Existing orders, prices and transitions are unchanged.
begin;
create index if not exists orders_work_queue_idx on public.orders(branch_id,promised_at,id)
 where deleted_at is null and status not in ('delivered','cancelled');
create index if not exists orders_client_queue_idx on public.orders(client_id,created_at desc,id)
 where deleted_at is null;

create or replace function public.crm_compact_order(b public.crm_board_facts,a public.profiles) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('id',b.id,'number',b.number,'code',b.code,'status',b.status,'branch_id',b.branch_id,
 'client_id',b.client_id,'client',jsonb_build_object('name',b.client_name,'phone',case when a.role::text in ('warehouse','washer','packer') then left(b.client_phone,4)||' ** *** ** '||right(b.client_phone,2) else b.client_phone end),
 'address',b.address,'street',b.street,'district_code',b.district_code,'district_priority',b.district_priority,
 'total',b.total,'pricing_state',b.pricing_state,'urgent',b.urgent,'carpet_m2',b.carpet_m2,'blankets',b.blankets,'tushaks',b.tushaks,
 'promised_at',b.promised_at,'stage_entered_at',b.stage_entered_at,'pickup_at',b.pickup_at,'pickup_state',b.pickup_state,'wash_phase',b.wash_phase,
 'is_overdue',coalesce(b.status not in ('delivered','cancelled') and b.promised_at<now(),false),
 'responsible_name',(select full_name from public.profiles where id=case b.status
   when 'pickup_planned' then b.pickup_driver_id when 'warehouse' then b.warehouse_received_by when 'washing' then b.washer_id
   when 'packing' then b.packing_received_by when 'in_transit' then b.delivery_driver_id when 'delivered' then b.delivery_driver_id when 'postponed' then b.delivery_driver_id else null end),
 'responsible_role',case when b.status in ('new','pickup_planned','ready_for_delivery','in_transit','postponed','delivered') then 'driver'
   when b.status='warehouse' then 'warehouse' when b.status='washing' then 'washer' when b.status='packing' then 'packer' else 'operator' end)
$$;

create or replace function public.crm_queue(p_filters jsonb,p_user uuid,p_home boolean default false) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;rows jsonb;stats jsonb;tiles jsonb;n bigint;lim int;off int;day_start timestamptz;
begin
 a:=public.crm_require(p_user,'read');perform set_config('app.board_user',p_user::text,true);
 if p_filters->>'from' is not null and p_filters->>'to' is not null and (p_filters->>'from')::date>(p_filters->>'to')::date then raise exception using errcode='23514',message='Проверьте период';end if;
 if p_filters->>'min_price' is not null and p_filters->>'max_price' is not null and (p_filters->>'min_price')::numeric>(p_filters->>'max_price')::numeric then raise exception using errcode='23514',message='Проверьте диапазон цены';end if;
 if p_filters->>'focus' is not null and p_filters->>'focus' not in ('attention','pickup_today','ready') then raise exception using errcode='23514',message='Неверный фильтр очереди';end if;
 lim:=least(greatest(coalesce((p_filters->>'limit')::int,50),1),100);off:=greatest(coalesce((p_filters->>'offset')::int,0),0);
 day_start:=((now() at time zone 'Asia/Tashkent')::date)::timestamp at time zone 'Asia/Tashkent';
 with base as materialized(select b.* from public.crm_board_rows(p_filters,p_user)b
  where (not p_home or b.status not in ('delivered','cancelled')) and (p_filters->>'client_id' is null or b.client_id=(p_filters->>'client_id')::uuid)),
 selected as materialized(select * from base b where case p_filters->>'focus'
  when 'attention' then b.status='postponed' or (b.status not in ('delivered','cancelled') and b.promised_at<now())
  when 'pickup_today' then b.status='pickup_planned' and b.pickup_state='pending' and b.pickup_at>=day_start and b.pickup_at<day_start+interval '1 day'
  when 'ready' then b.status='ready_for_delivery' else true end),
 page as (select b.* from selected b
  order by coalesce(b.status not in ('delivered','cancelled') and b.promised_at<now(),false) desc,case when a.role::text='driver' and b.status in ('new','ready_for_delivery') then b.district_priority else false end desc,
   b.promised_at asc nulls last,b.stage_entered_at,b.id limit lim offset off)
 select (select count(*) from selected),
 (select jsonb_build_object('orders',count(*),'carpet_m2',coalesce(sum(carpet_m2),0),'blankets',coalesce(sum(blankets),0),'tushaks',coalesce(sum(tushaks),0),'amount',coalesce(sum(total),0)) from selected),
 (select jsonb_build_object('attention',count(*) filter(where status='postponed' or (status not in ('delivered','cancelled') and promised_at<now())),
  'pickup_today',count(*) filter(where status='pickup_planned' and pickup_state='pending' and pickup_at>=day_start and pickup_at<day_start+interval '1 day'),
  'ready',count(*) filter(where status='ready_for_delivery')) from base),
 (select coalesce(jsonb_agg(public.crm_compact_order(row(p.*)::public.crm_board_facts,a) order by coalesce(p.status not in ('delivered','cancelled') and p.promised_at<now(),false) desc,case when a.role::text='driver' and p.status in ('new','ready_for_delivery') then p.district_priority else false end desc,p.promised_at asc nulls last,p.stage_entered_at,p.id),'[]') from page p)
 into n,stats,tiles,rows;
 return jsonb_build_object('data',rows,'count',n,'totals',stats,'tiles',tiles,'limit',lim,'offset',off,
  'next_offset',case when off+lim<n then off+lim end,'previous_offset',case when off>0 then greatest(off-lim,0) end,
  'date_basis','stage_entered_at','generated_at',clock_timestamp());
end $$;

create or replace function public.crm_clients(p_filters jsonb,p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;lim int;off int;rows jsonb;n bigint;begin
 a:=public.crm_require(p_user,'clients');
 if p_filters->>'branch_id' is not null then perform public.crm_require(p_user,'clients',(p_filters->>'branch_id')::uuid);end if;
 lim:=least(greatest(coalesce((p_filters->>'limit')::int,50),1),100);off:=greatest(coalesce((p_filters->>'offset')::int,0),0);
 with customers as materialized(
  select c.id,c.name,c.phone,c.address,coalesce(x.orders,0) orders,x.last_order_at from public.clients c
  left join lateral(select count(*) orders,max(o.created_at) last_order_at from public.orders o where o.client_id=c.id and public.crm_visible(o,a)
    and (p_filters->>'branch_id' is null or o.branch_id=(p_filters->>'branch_id')::uuid))x on true
  where (a.role::text='admin' or x.orders>0) and (p_filters->>'branch_id' is null or x.orders>0)
   and (coalesce(p_filters->>'q','')='' or position(lower(p_filters->>'q') in lower(c.name||' '||c.phone))>0
    or (length(regexp_replace(p_filters->>'q','\D','','g'))>=9 and position(regexp_replace(p_filters->>'q','\D','','g') in regexp_replace(c.phone,'\D','','g'))>0)))
 select (select count(*) from customers),(select coalesce(jsonb_agg(to_jsonb(p) order by p.last_order_at desc nulls last,p.id),'[]')
 from(select * from customers order by last_order_at desc nulls last,id limit lim offset off)p) into n,rows;
 return jsonb_build_object('data',rows,'count',n,'limit',lim,'offset',off,'next_offset',case when off+lim<n then off+lim end,'previous_offset',case when off>0 then greatest(off-lim,0) end);
end $$;

create or replace function public.crm_client_card(p_client uuid,p_branch uuid,p_user uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;client jsonb;rows jsonb;n bigint;begin
 a:=public.crm_require(p_user,'clients');if p_branch is not null then perform public.crm_require(p_user,'clients',p_branch);end if;
 select to_jsonb(c) into client from public.clients c where id=p_client;
 if client is null then raise exception using errcode='P0002',message='Клиент не найден';end if;
 perform set_config('app.board_user',p_user::text,true);
 select count(*) into n from public.crm_board_rows(jsonb_strip_nulls(jsonb_build_object('branch_id',p_branch)),p_user)b where b.client_id=p_client;
 if a.role::text<>'admin' and n=0 then raise exception using errcode='42501',message='Нет доступа к клиенту';end if;
 select coalesce(jsonb_agg(public.crm_compact_order(row(b.*)::public.crm_board_facts,a) order by b.created_at desc,b.id desc),'[]') into rows from
 (select * from public.crm_board_rows(jsonb_strip_nulls(jsonb_build_object('branch_id',p_branch)),p_user) z where z.client_id=p_client order by z.created_at desc,z.id desc limit 10)b;
 return jsonb_build_object('client',client,'addresses',(select coalesce(jsonb_agg(to_jsonb(q) order by (q.address=client->>'address') desc,q.created_at desc),'[]') from(select * from public.client_addresses where client_id=p_client order by (address=client->>'address') desc,created_at desc limit 10)q),
  'orders',rows,'orders_count',n,'branch_id',p_branch);
end $$;
revoke all on function public.crm_compact_order(public.crm_board_facts,public.profiles),public.crm_queue(jsonb,uuid,boolean),
 public.crm_clients(jsonb,uuid),public.crm_client_card(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_compact_order(public.crm_board_facts,public.profiles),public.crm_queue(jsonb,uuid,boolean),
 public.crm_clients(jsonb,uuid),public.crm_client_card(uuid,uuid,uuid) to service_role;
create or replace function public.crm_board(p_filters jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;stages text[];stage text;f jsonb;rows jsonb;totals jsonb;columns jsonb:='[]';lim int;off int;n bigint;begin
 a:=public.crm_require(p_user,'read');perform set_config('app.board_user',p_user::text,true);
 stages:=case a.role::text when 'driver' then array['new','pickup_planned','ready_for_delivery','in_transit','delivered','postponed'] when 'warehouse' then array['warehouse'] when 'washer' then array['washing'] when 'packer' then array['packing'] else array['new','pickup_planned','warehouse','washing','packing','ready_for_delivery','in_transit','delivered','postponed','cancelled'] end;
 foreach stage in array stages loop
  f:=(p_filters-'stages')||coalesce(p_filters->'stages'->stage,'{}')||jsonb_build_object('status',stage);
  if f->>'from' is not null and f->>'to' is not null and (f->>'from')::date>(f->>'to')::date then raise exception using errcode='23514',message='Проверьте период';end if;
  lim:=least(greatest(coalesce((f->>'limit')::int,15),1),100);off:=greatest(coalesce((f->>'offset')::int,0),0);
  select count(*),jsonb_build_object('orders',count(*),'carpet_m2',coalesce(sum(carpet_m2),0),'blankets',coalesce(sum(blankets),0),'tushaks',coalesce(sum(tushaks),0),'amount',coalesce(sum(total),0)) into n,totals from public.crm_board_rows(f,p_user);
  select coalesce(jsonb_agg(x order by priority desc,at,id),'[]') into rows from(
   select b.id,b.stage_entered_at at,case when a.role::text='driver' and stage in ('new','ready_for_delivery') then b.district_priority else false end priority,
    public.crm_compact_order(b,a) x
   from public.crm_board_rows(f,p_user)b order by priority desc,at,id limit lim offset off)q;
  -- Production cards do not expose the full phone embedded in the view.
  if a.role::text in ('warehouse','washer','packer') then select coalesce(jsonb_agg(x-'client_phone'),'[]') into rows from jsonb_array_elements(rows)x;end if;
  columns:=columns||jsonb_build_array(jsonb_build_object('status',stage,'totals',totals,'data',rows,'next_offset',case when off+lim<n then off+lim end,'filters',f));
 end loop;
 return jsonb_build_object('columns',columns,'driver_color',a.driver_color,'date_basis','stage_entered_at','at',clock_timestamp());
end $$;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset')
 and to_regprocedure('public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet)') is not null
 and to_regprocedure('public.crm_queue(jsonb,uuid,boolean)') is not null
 and has_function_privilege(current_user,'public.crm_queue(jsonb,uuid,boolean)','execute'),'schema',19)
$$;
commit;
