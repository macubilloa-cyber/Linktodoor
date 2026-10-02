-- Permite cambiar a mano el estado de una pre-alerta desde el panel.
-- La revisión automática diaria se salta las que tengan status_manual = true.
alter table public.package_alerts add column if not exists status_manual boolean not null default false;
