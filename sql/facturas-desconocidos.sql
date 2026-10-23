-- Cargo "Desconocidos" de la bodega (dirección mal escrita) por paquete
-- Correr una sola vez en Supabase → SQL Editor → New query → Run

alter table factura_lineas add column if not exists desconocido_crc numeric not null default 0;
