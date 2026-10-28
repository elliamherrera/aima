-- AIMA — esquema de cuentas, intenciones de depósito y avisos.
-- Ejecutar completo en el SQL Editor de Supabase (rol postgres) sobre un proyecto nuevo.
-- Se puede volver a ejecutar: reemplaza funciones, triggers y políticas.
--
-- La clave service_role no va en el sitio. Este archivo no crea pagos,
-- monederos ni rendimientos. Los depósitos solo se anotan como interés.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  aima_id text unique,
  nombre text not null default '',
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terms_accepted_at timestamptz,
  terms_version text,
  is_admin boolean not null default false,
  telefono text,
  fecha_nacimiento date,
  pais text,
  ciudad text,
  documento_tipo text,
  documento_numero text,
  kyc_estado text not null default 'no_iniciado'
);

alter table public.profiles add column if not exists aima_id text;
alter table public.profiles add column if not exists nombre text not null default '';
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists telefono text;
alter table public.profiles add column if not exists fecha_nacimiento date;
alter table public.profiles add column if not exists pais text;
alter table public.profiles add column if not exists ciudad text;
alter table public.profiles add column if not exists documento_tipo text;
alter table public.profiles add column if not exists documento_numero text;
alter table public.profiles add column if not exists kyc_estado text not null default 'no_iniciado';

alter table public.profiles drop constraint if exists profiles_nombre_len;
alter table public.profiles add constraint profiles_nombre_len check (char_length(nombre) <= 120);
alter table public.profiles drop constraint if exists profiles_terms_version_len;
alter table public.profiles add constraint profiles_terms_version_len check (terms_version is null or char_length(terms_version) <= 40);
alter table public.profiles drop constraint if exists profiles_telefono_len;
alter table public.profiles add constraint profiles_telefono_len check (telefono is null or char_length(telefono) <= 40);
alter table public.profiles drop constraint if exists profiles_pais_len;
alter table public.profiles add constraint profiles_pais_len check (pais is null or char_length(pais) <= 80);
alter table public.profiles drop constraint if exists profiles_ciudad_len;
alter table public.profiles add constraint profiles_ciudad_len check (ciudad is null or char_length(ciudad) <= 80);
alter table public.profiles drop constraint if exists profiles_documento_tipo_check;
alter table public.profiles add constraint profiles_documento_tipo_check check (
  documento_tipo is null or documento_tipo in ('cedula', 'pasaporte')
);
alter table public.profiles drop constraint if exists profiles_documento_numero_len;
alter table public.profiles add constraint profiles_documento_numero_len check (
  documento_numero is null or char_length(documento_numero) <= 40
);
alter table public.profiles drop constraint if exists profiles_kyc_estado_check;
alter table public.profiles add constraint profiles_kyc_estado_check check (
  kyc_estado in ('no_iniciado', 'datos_guardados')
);
alter table public.profiles drop constraint if exists profiles_aima_id_format;
alter table public.profiles add constraint profiles_aima_id_format check (
  aima_id is null or aima_id ~ '^AIMA-[A-Z0-9]{8}$'
);

create unique index if not exists profiles_aima_id_key on public.profiles (aima_id);
create index if not exists profiles_email_idx on public.profiles (email);

create table if not exists public.deposit_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(12, 2) not null,
  method text not null,
  status text not null default 'pendiente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.deposit_requests drop constraint if exists deposit_requests_amount_check;
alter table public.deposit_requests add constraint deposit_requests_amount_check check (
  amount > 0 and amount <= 1000000
);
alter table public.deposit_requests drop constraint if exists deposit_requests_method_check;
alter table public.deposit_requests add constraint deposit_requests_method_check check (
  method in (
    'Transferencia, cuando exista',
    'Tarjeta, cuando exista',
    'Otro medio futuro'
  )
);
alter table public.deposit_requests drop constraint if exists deposit_requests_status_check;
alter table public.deposit_requests add constraint deposit_requests_status_check check (
  status in ('pendiente', 'en_revision', 'archivada')
);

create index if not exists deposit_requests_user_created_idx
  on public.deposit_requests (user_id, created_at desc);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

alter table public.announcements drop constraint if exists announcements_title_len;
alter table public.announcements add constraint announcements_title_len check (char_length(title) between 3 and 120);
alter table public.announcements drop constraint if exists announcements_body_len;
alter table public.announcements add constraint announcements_body_len check (char_length(body) between 3 and 4000);

create index if not exists announcements_created_idx on public.announcements (created_at desc);

-- ---------------------------------------------------------------------------
-- Funciones
-- ---------------------------------------------------------------------------

create or replace function public.generate_aima_id()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
  attempt integer := 0;
begin
  loop
    attempt := attempt + 1;
    candidate := 'AIMA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.profiles where aima_id = candidate);
    if attempt >= 8 then
      raise exception 'No se pudo generar un ID AIMA único';
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_terms timestamptz;
  v_version text;
begin
  v_nombre := left(btrim(coalesce(new.raw_user_meta_data ->> 'nombre', '')), 120);
  v_version := left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), ''), 40);
  begin
    v_terms := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'terms_accepted_at', '')), '')::timestamptz;
  exception
    when others then
      v_terms := null;
  end;

  insert into public.profiles (id, nombre, email, aima_id, terms_accepted_at, terms_version)
  values (new.id, coalesce(v_nombre, ''), new.email, public.generate_aima_id(), v_terms, v_version)
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.fill_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.aima_id is null or btrim(new.aima_id) = '' then
    new.aima_id := public.generate_aima_id();
  end if;
  if auth.role() = 'authenticated' and auth.uid() is not null then
    new.id := auth.uid();
    new.is_admin := false;
  end if;
  if new.nombre is null then
    new.nombre := '';
  end if;
  new.nombre := left(btrim(new.nombre), 120);
  return new;
end;
$$;

create or replace function public.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    new.id := old.id;
    new.created_at := old.created_at;
    new.is_admin := old.is_admin;
    if old.aima_id is not null then
      new.aima_id := old.aima_id;
    end if;
    if old.email is not null then
      new.email := old.email;
    end if;
    if old.terms_accepted_at is not null then
      new.terms_accepted_at := old.terms_accepted_at;
    end if;
    if old.terms_version is not null then
      new.terms_version := old.terms_version;
    end if;
    if new.kyc_estado not in ('no_iniciado', 'datos_guardados') then
      new.kyc_estado := old.kyc_estado;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.fill_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and auth.uid() is not null then
    new.user_id := auth.uid();
    new.status := 'pendiente';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.protect_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if not public.is_admin() then
      raise exception 'no autorizado';
    end if;
    new.id := old.id;
    new.user_id := old.user_id;
    new.amount := old.amount;
    new.method := old.method;
    new.created_at := old.created_at;
    if new.status not in ('pendiente', 'en_revision', 'archivada') then
      raise exception 'estado no permitido';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.fill_announcement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if not public.is_admin() then
      raise exception 'no autorizado';
    end if;
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_fill on public.profiles;
create trigger profiles_fill
  before insert on public.profiles
  for each row execute function public.fill_profile();

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

drop trigger if exists deposit_requests_fill on public.deposit_requests;
create trigger deposit_requests_fill
  before insert on public.deposit_requests
  for each row execute function public.fill_deposit();

drop trigger if exists deposit_requests_protect on public.deposit_requests;
create trigger deposit_requests_protect
  before update on public.deposit_requests
  for each row execute function public.protect_deposit();

drop trigger if exists announcements_fill on public.announcements;
create trigger announcements_fill
  before insert on public.announcements
  for each row execute function public.fill_announcement();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.deposit_requests enable row level security;
alter table public.announcements enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and is_admin = false);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists deposit_requests_select on public.deposit_requests;
create policy deposit_requests_select on public.deposit_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists deposit_requests_insert on public.deposit_requests;
create policy deposit_requests_insert on public.deposit_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'pendiente');

drop policy if exists deposit_requests_update on public.deposit_requests;
create policy deposit_requests_update on public.deposit_requests
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (published = true or public.is_admin());

drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Permisos del API (anon no tiene acceso a estas tablas)
-- ---------------------------------------------------------------------------

revoke all on public.profiles from public, anon;
revoke all on public.deposit_requests from public, anon;
revoke all on public.announcements from public, anon;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.deposit_requests to authenticated;
grant select, insert, update on public.announcements to authenticated;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.generate_aima_id() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.fill_profile() from public, anon;
revoke all on function public.protect_profile() from public, anon;
revoke all on function public.fill_deposit() from public, anon;
revoke all on function public.protect_deposit() from public, anon;
revoke all on function public.fill_announcement() from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.generate_aima_id() to authenticated;
grant execute on function public.fill_profile() to authenticated;
grant execute on function public.protect_profile() to authenticated;
grant execute on function public.fill_deposit() to authenticated;
grant execute on function public.protect_deposit() to authenticated;
grant execute on function public.fill_announcement() to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Para nombrar a la primera persona administradora, después de que se registre:
--   update public.profiles set is_admin = true where email = 'correo@ejemplo.com';
-- Ese update se hace aquí, en el SQL Editor. La API no deja que una cuenta
-- se conceda is_admin a sí misma.
