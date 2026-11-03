-- Supabase Cron keeps monthly cash reports independent of the free Render web process.
-- UTC 19:00 is 00:00 Asia/Tashkent. The idempotent function retries any missed months.
begin;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
do $$ begin
 if coalesce(current_setting('cron.timezone',true),'GMT') not in ('GMT','UTC','Etc/UTC') then
  raise exception 'Cron timezone must be UTC/GMT for the documented cash schedule';
 end if;
 if public.crm_cash_basis()<>'receipt' then
  raise exception 'Cash receipt policy differs from the approved rule';
 end if;
end $$;
select cron.schedule('crm-cash-month-close','0 19 * * *','select public.crm_cash_close_due_months();');
commit;
