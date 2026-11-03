-- PostgREST loads safeupdate: UPDATE without WHERE is rejected even for a singleton.
-- Update only the row locked above; keep invoker permissions, revision checks and audit.
-- CREATE OR REPLACE preserves the existing service_role-only EXECUTE grants.
-- No saved settings, uploaded images or business data are changed by this migration.
begin;
create or replace function public.crm_branding_save(p_data jsonb,p_user uuid,p_ip inet) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_row public.organization_branding;desired jsonb;begin
 perform public.crm_branding_require_admin(p_user);perform public.lifecycle_actor(p_user,p_ip);
 if not(p_data ?& array['organization_name','subtitle','mode','accent_color','background_color','sidebar_color','logo_id','background_id','background_opacity','expected_revision'])
 or exists(select 1 from jsonb_object_keys(p_data) k where k<>all(array['organization_name','subtitle','mode','accent_color','background_color','sidebar_color','logo_id','background_id','background_opacity','expected_revision'])) then
  raise exception using errcode='23514',message='Проверьте поля оформления';end if;
 select * into current_row from public.organization_branding where id='00000000-0000-4000-8000-000000000022' for update;
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
 revision=revision+1,updated_at=clock_timestamp(),updated_by=p_user where id=current_row.id;
 perform set_config('app.branding_write','',true);return public.crm_branding_public();
end $$;
notify pgrst,'reload schema';
commit;
