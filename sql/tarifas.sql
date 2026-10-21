-- Precio especial por libra para cada cliente (vacío = tarifa estándar ₡3,950)
-- Correr una sola vez en Supabase → SQL Editor → New query → Run

alter table saved_clients add column if not exists rate_per_lb numeric;

-- Un cliente no puede cambiarse su propio precio desde el portal
create or replace function public.protect_client_identity() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.name is distinct from old.name
          or new.email is distinct from old.email
          or new.referral_code is distinct from old.referral_code
          or new.referred_by is distinct from old.referred_by
          or new.rate_per_lb is distinct from old.rate_per_lb) then
    raise exception 'No se puede cambiar el nombre, email, precio ni los datos de referido del perfil';
  end if;
  return new;
end $$;
