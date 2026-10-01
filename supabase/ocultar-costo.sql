-- Parche: si ya corriste seguridad.sql antes de este cambio, corré solo esto.

-- Los clientes NO leen la tabla cargas (tiene el costo). Solo ven esta vista,
-- sin costo ni peso total, y únicamente de las cargas donde tienen paquetes.
drop policy if exists client_read_own on public.cargas;
create or replace view public.client_cargas with (security_barrier) as
  select c.id, c.reference, c.date, c.status
  from public.cargas c
  where exists (select 1 from public.carga_clients cc
                where cc.carga_id = c.id
                  and lower(trim(cc.client_name)) = public.my_client_name());
revoke all on public.client_cargas from anon, authenticated, public;
grant select on public.client_cargas to authenticated;
