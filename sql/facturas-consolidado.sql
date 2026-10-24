-- Paquetes de la bodega consolidada (2071) importados desde el mensaje de WhatsApp
-- Correr una sola vez en Supabase → SQL Editor → New query → Run

alter table factura_lineas add column if not exists bodega text not null default 'AM';
