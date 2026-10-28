-- Ковёр CRM: схема для Supabase (PostgreSQL). Запускать в SQL Editor или через `supabase db push`.
create extension if not exists pgcrypto;

create type user_role as enum ('admin','operator','driver','workshop');
create type order_status as enum
  ('new','pickup_assigned','received','washing','drying','ready','delivering','delivered','cancelled');

-- Сотрудники (расширение auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role user_role not null default 'operator',
  active boolean not null default false,   -- новый пользователь неактивен, пока админ не включит
  created_at timestamptz not null default now()
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null,
  phone_key text generated always as (right(regexp_replace(phone, '\D', '', 'g'), 9)) stored,
  address text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  constraint clients_phone_key_uq unique (phone_key),
  constraint clients_phone_len check (length(regexp_replace(phone, '\D', '', 'g')) >= 9)
);

create table tariffs (
  code text primary key,
  name text not null,
  price_per_m2 numeric(12,0) not null check (price_per_m2 >= 0),
  active boolean not null default true
);
insert into tariffs values ('wool','Шерсть',30000,true),('syn','Синтетика',20000,true),('silk','Шёлк',60000,true);

create table settings (key text primary key, value numeric not null);
insert into settings values
  ('urgent_pct',0.30),('stains_pct',0.15),('pensioner_pct',-0.10),
  ('free_delivery_from',150000),('delivery_fee',20000);
create function setting(k text) returns numeric language sql stable as $$ select value from settings where key = k $$;

create table orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity (start with 1041) unique,   -- K-1041, K-1042, ...
  client_id uuid not null references clients(id),
  address text not null,
  pickup_date date,
  pickup_slot text,
  driver_id uuid references profiles(id) on delete set null,
  status order_status not null default 'new',
  source text not null default 'call_in',
  comment text,
  urgent boolean not null default false,
  stains boolean not null default false,
  pensioner boolean not null default false,
  subtotal numeric(12,0) not null default 0,
  adjustment numeric(12,0) not null default 0,
  delivery_fee numeric(12,0) not null default 0,
  total numeric(12,0) not null default 0,
  track_token text not null unique default encode(gen_random_bytes(12), 'hex'),  -- публичная ссылка статуса
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on orders (status);
create index on orders (driver_id, status);
create index on orders (client_id);
create index on orders (pickup_date);

create table order_items (            -- ковры
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  seq int not null,                   -- метка ковра: K-1041-1, K-1041-2
  length_m numeric(5,2) not null check (length_m > 0),
  width_m numeric(5,2) not null check (width_m > 0),
  area_m2 numeric(8,2) generated always as (length_m * width_m) stored,
  tariff_code text not null references tariffs(code),
  note text,
  price numeric(12,0) not null default 0,
  unique (order_id, seq)
);

create table order_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references order_items(id) on delete cascade,
  storage_path text not null,
  kind text not null default 'intake' check (kind in ('intake','ready')),
  created_by uuid,
  created_at timestamptz not null default now()
);

create table status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id) on delete cascade,
  status order_status not null,
  changed_by uuid,
  note text,
  created_at timestamptz not null default now()
);
create index on status_history (order_id, created_at);

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger orders_touch before update on orders for each row execute function touch_updated_at();

-- Профиль создаётся автоматически при регистрации пользователя в Supabase Auth
create function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------- Бизнес-логика ----------
-- Расчёт цены (единственный источник правды: и для превью, и при создании заказа)
create function quote_order(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare it jsonb; t numeric; a numeric; area numeric := 0; sub numeric := 0; m numeric; tot numeric; fee numeric := 0;
begin
  for it in select * from jsonb_array_elements(p->'items') loop
    select price_per_m2 into t from tariffs where code = it->>'tariff' and active;
    if t is null then raise exception 'Неизвестный тариф: %', it->>'tariff'; end if;
    a := (it->>'length_m')::numeric * (it->>'width_m')::numeric;
    area := area + a;  sub := sub + round(a * t);
  end loop;
  m := 1 + case when coalesce((p->>'urgent')::boolean,false)    then setting('urgent_pct')    else 0 end
         + case when coalesce((p->>'stains')::boolean,false)    then setting('stains_pct')    else 0 end
         + case when coalesce((p->>'pensioner')::boolean,false) then setting('pensioner_pct') else 0 end;
  tot := round(sub * m, -3);
  if sub > 0 and sub < setting('free_delivery_from') then fee := setting('delivery_fee'); end if;
  return jsonb_build_object('area_m2', round(area,2), 'subtotal', sub, 'adjustment', tot - sub,
                            'delivery_fee', fee, 'total', tot + fee);
end $$;

-- Создание заказа одной транзакцией: клиент (по телефону) + заказ + ковры + первая запись истории
create function create_order(p jsonb, p_user uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; oid uuid; q jsonb; it jsonb; i int := 0; t numeric; l numeric; w numeric;
begin
  q := quote_order(p);
  insert into clients(name, phone, address)
    values (coalesce(p->>'name',''), p->>'phone', coalesce(p->>'address',''))
  on conflict (phone_key) do update
    set name = coalesce(nullif(excluded.name,''), clients.name),
        address = coalesce(nullif(excluded.address,''), clients.address)
  returning id into cid;

  insert into orders(client_id, address, pickup_date, pickup_slot, source, comment, urgent, stains, pensioner,
                     subtotal, adjustment, delivery_fee, total, created_by)
  values (cid, p->>'address', (p->>'pickup_date')::date, p->>'pickup_slot', coalesce(p->>'source','call_in'), p->>'comment',
          coalesce((p->>'urgent')::boolean,false), coalesce((p->>'stains')::boolean,false), coalesce((p->>'pensioner')::boolean,false),
          (q->>'subtotal')::numeric, (q->>'adjustment')::numeric, (q->>'delivery_fee')::numeric, (q->>'total')::numeric, p_user)
  returning id into oid;

  for it in select * from jsonb_array_elements(p->'items') loop
    i := i + 1;
    l := (it->>'length_m')::numeric;  w := (it->>'width_m')::numeric;
    select price_per_m2 into t from tariffs where code = it->>'tariff';
    insert into order_items(order_id, seq, length_m, width_m, tariff_code, note, price)
      values (oid, i, l, w, it->>'tariff', it->>'note', round(l * w * t));
  end loop;

  insert into status_history(order_id, status, changed_by) values (oid, 'new', p_user);
  return oid;
end $$;

-- Смена статуса: шаг вперёд/назад или отмена; пишет историю
create function change_order_status(p_order uuid, p_status order_status, p_user uuid, p_note text default null)
returns order_status language plpgsql security definer set search_path = public as $$
declare o orders; a int; b int; flow order_status[] := enum_range('new'::order_status, 'delivered'::order_status);
begin
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'Заказ не найден'; end if;
  if o.status = p_status then return o.status; end if;
  if o.status in ('delivered','cancelled') then raise exception 'Заказ уже закрыт'; end if;
  if p_status <> 'cancelled' then
    a := array_position(flow, o.status);  b := array_position(flow, p_status);
    if abs(a - b) <> 1 then raise exception 'Недопустимый переход: % → %', o.status, p_status; end if;
  end if;
  if p_status = 'pickup_assigned' and o.driver_id is null then raise exception 'Сначала назначьте водителя'; end if;
  update orders set status = p_status where id = p_order;
  insert into status_history(order_id, status, changed_by, note) values (p_order, p_status, p_user, p_note);
  return p_status;
end $$;

-- Публичный статус по токену (без персональных данных)
create function public_order_status(p_token text) returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'code', 'K-' || o.number, 'status', o.status, 'pickup_date', o.pickup_date, 'total', o.total,
    'items', (select count(*) from order_items i where i.order_id = o.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h.status, 'at', h.created_at) order by h.created_at), '[]'::jsonb)
                from status_history h where h.order_id = o.id))
  from orders o where o.track_token = p_token $$;

revoke execute on function quote_order(jsonb), create_order(jsonb,uuid), change_order_status(uuid,order_status,uuid,text),
  public_order_status(text) from public, anon, authenticated;
grant execute on function quote_order(jsonb), create_order(jsonb,uuid), change_order_status(uuid,order_status,uuid,text),
  public_order_status(text) to service_role;

-- ---------- Безопасность (RLS) ----------
-- API работает с service_role и сам проверяет роли. RLS закрывает прямой доступ к таблицам через публичный ключ.
create function is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and active) $$;

do $$ declare t text; begin
  foreach t in array array['profiles','clients','tariffs','settings','orders','order_items','order_photos','status_history'] loop
    execute format('alter table %I enable row level security', t);
    if t <> 'profiles' then
      execute format('create policy staff_read on %I for select to authenticated using (is_staff())', t);
    end if;
  end loop;
end $$;
create policy own_profile on profiles for select to authenticated using (id = auth.uid());

-- Приватное хранилище фото
insert into storage.buckets (id, name, public) values ('carpet-photos', 'carpet-photos', false) on conflict do nothing;
