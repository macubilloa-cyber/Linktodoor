-- Bandeja de facturas de la bodega (AM): una fila por paquete de la factura.
-- Correr una sola vez en Supabase → SQL Editor → New query → Run

create table if not exists factura_lineas (
  id              uuid primary key default gen_random_uuid(),
  factura         text    not null,           -- número de factura de la bodega
  linea_id        text    not null,           -- id de línea dentro de la factura
  carga_id        text,
  tracking        text    not null,
  trackings       text[]  not null default '{}',
  weight_lbs      numeric not null,
  cost_crc        numeric not null,           -- lo que cobra la bodega a Linktodoor
  client_name     text,                       -- null = pendiente de asignar
  carga_client_id text,
  package_id      text,
  created_at      timestamptz not null default now(),
  unique (factura, linea_id)
);
create index if not exists factura_lineas_pendientes_idx on factura_lineas (client_name);

alter table factura_lineas enable row level security;
drop policy if exists admin_all on factura_lineas;
create policy admin_all on factura_lineas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
