-- Shared branding for this installation. Company provisioning is a separate, deferred task.
begin;
create table public.branding_assets(
 id uuid primary key,kind text not null check(kind in ('logo','background')),
 path text not null unique,content_type text not null check(content_type in ('image/png','image/jpeg','image/webp')),
 bytes integer not null check(bytes between 12 and 2097152),created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 check(path=kind||'/'||id::text||case content_type when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.webp' end)
);
create table public.organization_branding(
 id uuid primary key default '00000000-0000-4000-8000-000000000022' check(id='00000000-0000-4000-8000-000000000022'),
 organization_name text check(organization_name is null or length(btrim(organization_name)) between 1 and 80),
 subtitle text check(subtitle is null or length(subtitle)<=120),mode text not null default 'light' check(mode in ('light','dark')),
 accent_color text not null default '#2a3990' check(accent_color~'^#[0-9a-fA-F]{6}$'),
 background_color text not null default '#f4f5f9' check(background_color~'^#[0-9a-fA-F]{6}$'),
 sidebar_color text not null default '#ffffff' check(sidebar_color~'^#[0-9a-fA-F]{6}$'),
 logo_id uuid references public.branding_assets(id),background_id uuid references public.branding_assets(id),
 background_opacity numeric(4,3) not null default 0.12 check(background_opacity between 0 and 0.2),
 revision integer not null default 0 check(revision>=0),updated_at timestamptz not null default clock_timestamp(),updated_by uuid references public.profiles(id)
);
insert into public.organization_branding default values;
alter table public.branding_assets enable row level security;
alter table public.organization_branding enable row level security;
revoke all on public.branding_assets,public.organization_branding from public,anon,authenticated,service_role;
grant select,insert on public.branding_assets to service_role;
grant select,update on public.organization_branding to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('organization-branding','organization-branding',false,2097152,array['image/png','image/jpeg','image/webp']);

create function public.crm_branding_require_admin(p_user uuid) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare a public.profiles;begin
 a:=public.crm_require(p_user,'staff');if a.role::text<>'admin' then raise exception using errcode='42501',message='Оформление доступно только администратору';end if;return true;
end $$;
create function public.crm_branding_guard() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if current_setting('app.branding_write',true) is distinct from 'allowed' then raise exception using errcode='42501',message='Используйте настройки оформления';end if;
 perform public.crm_branding_require_admin(nullif(current_setting('app.actor_id',true),'')::uuid);
 if (tg_table_name='organization_branding' and (tg_op<>'UPDATE' or new.id<>old.id)) or (tg_table_name='branding_assets' and tg_op<>'INSERT') then
  raise exception using errcode='55000',message='Историю оформления изменять нельзя';end if;return new;
end $$;
create trigger branding_settings_guard before insert or update or delete on public.organization_branding for each row execute function public.crm_branding_guard();
create trigger branding_assets_guard before insert or update or delete on public.branding_assets for each row execute function public.crm_branding_guard();
create trigger branding_settings_audit after update on public.organization_branding for each row execute function public.crm_audit_change();
create trigger branding_assets_audit after insert on public.branding_assets for each row execute function public.crm_audit_change();

create function public.crm_branding_public() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select to_jsonb(b)-'id'-'updated_by' from public.organization_branding b
$$;
create function public.crm_branding_asset(p_id uuid) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('id',id,'path',path,'content_type',content_type,'bytes',bytes) from public.branding_assets where id=p_id
$$;
create function public.crm_branding_asset_register(p_id uuid,p_kind text,p_path text,p_type text,p_size integer,p_user uuid,p_ip inet) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare result public.branding_assets;begin
 perform public.crm_branding_require_admin(p_user);perform public.lifecycle_actor(p_user,p_ip);perform set_config('app.branding_write','allowed',true);
 insert into public.branding_assets(id,kind,path,content_type,bytes,created_by) values(p_id,p_kind,p_path,p_type,p_size,p_user) returning * into result;
 perform set_config('app.branding_write','',true);return to_jsonb(result);
end $$;
create function public.crm_branding_save(p_data jsonb,p_user uuid,p_ip inet) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_row public.organization_branding;desired jsonb;begin
 perform public.crm_branding_require_admin(p_user);perform public.lifecycle_actor(p_user,p_ip);
 if not(p_data ?& array['organization_name','subtitle','mode','accent_color','background_color','sidebar_color','logo_id','background_id','background_opacity','expected_revision'])
 or exists(select 1 from jsonb_object_keys(p_data) k where k<>all(array['organization_name','subtitle','mode','accent_color','background_color','sidebar_color','logo_id','background_id','background_opacity','expected_revision'])) then
  raise exception using errcode='23514',message='Проверьте поля оформления';end if;
 select * into current_row from public.organization_branding for update;
 desired:=p_data-'expected_revision';
 if current_row.revision is distinct from (p_data->>'expected_revision')::integer then
  if (to_jsonb(current_row)-array['id','revision','updated_at','updated_by'])=desired then return public.crm_branding_public();end if;
  raise exception using errcode='55000',message='Настройки уже изменены. Обновите страницу перед сохранением';
 end if;
 if (p_data->>'logo_id') is not null and not exists(select 1 from public.branding_assets where id=(p_data->>'logo_id')::uuid and kind='logo') then raise exception using errcode='23514',message='Логотип не найден';end if;
 if (p_data->>'background_id') is not null and not exists(select 1 from public.branding_assets where id=(p_data->>'background_id')::uuid and kind='background') then raise exception using errcode='23514',message='Фон не найден';end if;
 perform set_config('app.branding_write','allowed',true);
 update public.organization_branding set organization_name=p_data->>'organization_name',subtitle=p_data->>'subtitle',mode=p_data->>'mode',
 accent_color=p_data->>'accent_color',background_color=p_data->>'background_color',sidebar_color=p_data->>'sidebar_color',
 logo_id=(p_data->>'logo_id')::uuid,background_id=(p_data->>'background_id')::uuid,background_opacity=(p_data->>'background_opacity')::numeric,
 revision=revision+1,updated_at=clock_timestamp(),updated_by=p_user;
 perform set_config('app.branding_write','',true);return public.crm_branding_public();
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'crm_branding_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;
end $$;
create or replace function public.crm_ready() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object('ok',exists(select 1 from public.maintenance_cleanup_runs where key='workflow_v2_reset')
 and to_regprocedure('public.crm_save_pickup_items(uuid,jsonb,jsonb,uuid,uuid,inet)') is not null
 and to_regprocedure('public.crm_queue(jsonb,uuid,boolean)') is not null
 and has_function_privilege(current_user,'public.crm_queue(jsonb,uuid,boolean)','execute')
 and to_regprocedure('public.crm_cash_day(jsonb,uuid)') is not null
 and has_function_privilege(current_user,'public.crm_cash_day(jsonb,uuid)','execute')
 and to_regprocedure('public.crm_cash_close_due_months()') is not null
 and to_regclass('public.cash_month_closures') is not null
 and to_regprocedure('public.crm_branding_save(jsonb,uuid,inet)') is not null
 and has_function_privilege(current_user,'public.crm_branding_public()','execute'),'schema',22)
$$;
notify pgrst,'reload schema';
commit;
