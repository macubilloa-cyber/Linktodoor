-- Programa de fidelidad + referidos de Linktodoor
-- Correr una sola vez en Supabase → SQL Editor → New query → Run

alter table saved_clients add column if not exists referral_code text;
alter table saved_clients add column if not exists referred_by   text;
create unique index if not exists saved_clients_referral_code_key on saved_clients (referral_code);

-- Libro de créditos: cada ganancia o canje es una fila
create table if not exists client_credits (
  id         uuid primary key default gen_random_uuid(),
  client_id  text        not null,
  tipo       text        not null,  -- fidelidad | referido_dado | canje
  monto_crc  numeric     not null,  -- positivo = gana, negativo = canje
  origen     text,                  -- ej: cc:<carga_client_id>, ref:<client_id>
  nota       text,
  created_at timestamptz not null default now(),
  expira_at  timestamptz
);
create index if not exists client_credits_client_idx on client_credits (client_id);

-- Un referido solo puede premiarse una vez (primer envío)
create table if not exists referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_id     text    not null,
  referred_id     text    not null unique,
  carga_client_id text,
  discount_crc    numeric not null default 0,  -- descuento al referido
  reward_crc      numeric not null default 0,  -- crédito a quien refirió
  created_at      timestamptz not null default now()
);
create index if not exists referrals_referrer_idx on referrals (referrer_id);

-- Solo se accede desde /api con la service key
alter table client_credits enable row level security;
alter table referrals      enable row level security;

-- Un cliente no puede editarse su propio código ni quién lo refirió desde el portal
create or replace function public.protect_client_identity() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.name is distinct from old.name
          or new.email is distinct from old.email
          or new.referral_code is distinct from old.referral_code
          or new.referred_by is distinct from old.referred_by) then
    raise exception 'No se puede cambiar el nombre, email ni los datos de referido del perfil';
  end if;
  return new;
end $$;
