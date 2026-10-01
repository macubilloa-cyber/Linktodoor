-- Seguridad de la base de datos de Linktodoor.
-- Admin (linktodoor@hotmail.com): acceso total desde el panel.
-- Clientes del portal: solo leen sus propios datos.
-- Público (landing): sin acceso directo; el registro va por /api/register.

-- 1) Marcar la cuenta del panel como administrador
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where lower(email) = 'linktodoor@hotmail.com';

-- 2) Funciones auxiliares
create or replace function public.is_admin() returns boolean
language sql stable
as $$ select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin' $$;

create or replace function public.my_client_name() returns text
language sql stable security definer set search_path = public
as $$
  select lower(trim(name)) from public.saved_clients
  where lower(email) = lower(auth.jwt() ->> 'email')
  limit 1
$$;

-- 3) Borrar las reglas abiertas anteriores
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public'
             and tablename in ('cargas','carga_clients','packages','saved_clients','package_alerts')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.cargas         enable row level security;
alter table public.carga_clients  enable row level security;
alter table public.packages       enable row level security;
alter table public.saved_clients  enable row level security;
alter table public.package_alerts enable row level security;

-- 4) Admin: acceso total
create policy admin_all on public.cargas         for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.carga_clients  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.packages       for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.saved_clients  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_all on public.package_alerts for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 5) Clientes: solo lo suyo
create policy client_read_own on public.saved_clients for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));
create policy client_update_own on public.saved_clients for update to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'))
  with check (lower(email) = lower(auth.jwt() ->> 'email'));

create policy client_read_own on public.carga_clients for select to authenticated
  using (lower(trim(client_name)) = public.my_client_name());

create policy client_read_own on public.packages for select to authenticated
  using (exists (select 1 from public.carga_clients cc
                 where cc.id = packages.carga_client_id
                   and lower(trim(cc.client_name)) = public.my_client_name()));

create policy client_read_own on public.cargas for select to authenticated
  using (exists (select 1 from public.carga_clients cc
                 where cc.carga_id = cargas.id
                   and lower(trim(cc.client_name)) = public.my_client_name()));

create policy client_read_own on public.package_alerts for select to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));
create policy client_delete_own on public.package_alerts for delete to authenticated
  using (lower(user_email) = lower(auth.jwt() ->> 'email'));

-- 6) Un cliente no puede cambiarse el nombre ni el email desde el portal
create or replace function public.protect_client_identity() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.name is distinct from old.name or new.email is distinct from old.email) then
    raise exception 'No se puede cambiar el nombre ni el email del perfil';
  end if;
  return new;
end $$;

drop trigger if exists protect_client_identity on public.saved_clients;
create trigger protect_client_identity before update on public.saved_clients
  for each row execute function public.protect_client_identity();
