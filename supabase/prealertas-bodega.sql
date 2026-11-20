-- Bodega a la que el cliente mandó el paquete al pre-alertarlo desde el portal.
-- 'flash' = bodega 5414 (Noblex) · 'consolidada' = bodega 2071 (Box2Box) · null = pre-alertas viejas sin bodega.
alter table public.package_alerts add column if not exists bodega text;
alter table public.package_alerts drop constraint if exists package_alerts_bodega_check;
alter table public.package_alerts add constraint package_alerts_bodega_check
  check (bodega is null or bodega in ('flash', 'consolidada'));
