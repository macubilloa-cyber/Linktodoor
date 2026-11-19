-- Enlaces de acceso para clientes nuevos (el cliente crea su propia contraseña)
-- Correr una sola vez en Supabase → SQL Editor → New query → Run

create table if not exists portal_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text        not null,
  token_hash  text        not null unique,   -- solo se guarda el hash; el enlace no se puede recuperar
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index if not exists portal_invites_email_idx on portal_invites (lower(email));

-- Solo se accede desde /api con la service key
alter table portal_invites enable row level security;
