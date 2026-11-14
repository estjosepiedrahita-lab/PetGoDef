-- =====================================================================
-- PetGo · 03 · Proveedores de servicios (independientes y empresas)
-- Se puede ejecutar más de una vez. No borra datos existentes.
-- Requiere haber ejecutado antes schema.sql.
-- =====================================================================

-- ---------- 1. Rol en el perfil --------------------------------------
alter table public.profiles add column if not exists rol text not null default 'dueno';
alter table public.profiles drop constraint if exists profiles_rol_check;
alter table public.profiles add constraint profiles_rol_check check (rol in ('dueno', 'proveedor'));

-- El rol se toma de los datos de registro, pero solo se acepta 'proveedor'; cualquier otro valor es 'dueno'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nombre, correo, rol)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'nombre', ''),
                   nullif(new.raw_user_meta_data ->> 'full_name', ''),
                   nullif(new.raw_user_meta_data ->> 'name', ''), ''),
          new.email,
          case when new.raw_user_meta_data ->> 'rol' = 'proveedor' then 'proveedor' else 'dueno' end)
  on conflict (id) do nothing;
  insert into public.notifications (user_id, texto)
  values (new.id, '¡Bienvenido a PetGo! ' ||
          case when new.raw_user_meta_data ->> 'rol' = 'proveedor'
               then 'Publica tu primer servicio desde tu panel.' else 'Reserva tu primer servicio.' end);
  return new;
end $$;

-- Nadie puede cambiarse el rol desde la app (el perfil solo permite editar estos campos)
revoke update on public.profiles from authenticated;
grant update (nombre, telefono, ciudad) on public.profiles to authenticated;

-- ---------- 2. Negocio y equipo --------------------------------------
create table if not exists public.businesses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  tipo        text not null check (tipo in ('individual', 'empresa')),
  nombre      text not null check (length(trim(nombre)) > 0 and length(nombre) <= 80),
  zona        text not null default 'Bogotá' check (length(zona) <= 80),
  descripcion text not null default '' check (length(descripcion) <= 350),
  cantidad    integer not null default 1 check (cantidad between 1 and 500),
  created_at  timestamptz not null default now()
);

create table if not exists public.workers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) > 0 and length(nombre) <= 80),
  funcion     text not null default 'Otro' check (length(funcion) <= 40),
  descripcion text not null default '' check (length(descripcion) <= 150),
  created_at  timestamptz not null default now()
);
create index if not exists workers_business_idx on public.workers(business_id);

-- ---------- 3. Ofertas = filas del catálogo con dueño -----------------
alter table public.professionals add column if not exists business_id uuid references public.businesses(id) on delete cascade;
alter table public.professionals add column if not exists disponible boolean not null default true;
alter table public.professionals add column if not exists tipo text check (tipo in ('individual', 'empresa'));
alter table public.professionals add column if not exists trabajadores integer;
alter table public.professionals alter column id set default ('o-' || replace(gen_random_uuid()::text, '-', ''));
create index if not exists professionals_business_idx on public.professionals(business_id);

-- Tipo de los profesionales del catálogo inicial
update public.professionals set tipo = 'individual', trabajadores = 1
  where business_id is null and tipo is null and id in ('happy-walk', 'spa-canino-bogota', 'patas-limpias');
update public.professionals set tipo = 'empresa'
  where business_id is null and tipo is null;

-- En las ofertas de un negocio, los datos del negocio y la reputación los fija la base de datos, no el cliente
create or replace function public.offers_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare b public.businesses%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.business_id is null then return new; end if;      -- catálogo base (lo carga el administrador)
    new.rating := 0; new.resenas := 0; new.activo := true;
  else
    if old.business_id is null then return new; end if;
    new.business_id := old.business_id;
    new.rating := old.rating; new.resenas := old.resenas;
  end if;
  select * into b from public.businesses where id = new.business_id;
  new.nombre := b.nombre; new.zona := b.zona; new.tipo := b.tipo;
  new.trabajadores := case when b.tipo = 'empresa' then b.cantidad else 1 end;
  new.detalle := new.descripcion;
  return new;
end $$;
drop trigger if exists offers_guard_t on public.professionals;
create trigger offers_guard_t before insert or update on public.professionals
  for each row execute function public.offers_guard();

-- Si cambia el negocio, se actualizan sus ofertas
create or replace function public.business_sync_offers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.professionals
     set nombre = new.nombre, zona = new.zona, tipo = new.tipo,
         trabajadores = case when new.tipo = 'empresa' then new.cantidad else 1 end
   where business_id = new.id;
  return new;
end $$;
drop trigger if exists business_sync_t on public.businesses;
create trigger business_sync_t after update on public.businesses
  for each row execute function public.business_sync_offers();

-- No se puede reservar una oferta marcada como "sin cupos"
create or replace function public.bookings_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.professionals%rowtype;
begin
  new.user_id := auth.uid();
  new.estado  := 'confirmada';

  select * into p from public.professionals where id = new.professional_id and activo and disponible;
  if not found then raise exception 'PROFESIONAL_NO_DISPONIBLE'; end if;
  new.servicio := case p.servicio when 'paseo' then 'Paseo' else 'Baño y peluquería' end;
  new.precio := p.precio;
  new.duracion_min := p.duracion_min;

  if new.fecha < (now() at time zone 'America/Bogota')::date then
    raise exception 'FECHA_PASADA';
  end if;

  if (select count(*) from public.bookings
      where user_id = new.user_id and estado = 'confirmada') >= 5 then
    raise exception 'LIMITE_RESERVAS';
  end if;
  return new;
end $$;

-- ---------- 4. Citas recibidas por el proveedor ----------------------
-- Devuelve las reservas de las ofertas del proveedor con el nombre del cliente
-- (el proveedor no puede leer la tabla bookings ni los perfiles directamente)
create or replace function public.provider_bookings()
returns table (id uuid, offer_id text, servicio text, cliente text, pet_nombre text, fecha date, hora time, estado text)
language sql stable security definer set search_path = '' as $$
  select k.id, k.professional_id, k.servicio, coalesce(nullif(pr.nombre, ''), 'Cliente'), k.pet_nombre, k.fecha, k.hora, k.estado
  from public.bookings k
  join public.professionals o on o.id = k.professional_id
  join public.businesses b on b.id = o.business_id and b.owner_id = auth.uid()
  left join public.profiles pr on pr.id = k.user_id
  order by k.fecha, k.hora;
$$;
revoke all on function public.provider_bookings() from public;
grant execute on function public.provider_bookings() to authenticated;

-- ---------- 5. Seguridad por fila (RLS) ------------------------------
alter table public.businesses enable row level security;
alter table public.workers    enable row level security;

drop policy if exists businesses_all on public.businesses;
create policy businesses_all on public.businesses for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists workers_all on public.workers;
create policy workers_all on public.workers for all to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));

drop policy if exists professionals_select on public.professionals;
create policy professionals_select on public.professionals for select to anon, authenticated
  using (activo or business_id in (select id from public.businesses where owner_id = auth.uid()));

drop policy if exists professionals_owner_insert on public.professionals;
drop policy if exists professionals_owner_update on public.professionals;
drop policy if exists professionals_owner_delete on public.professionals;
create policy professionals_owner_insert on public.professionals for insert to authenticated
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy professionals_owner_update on public.professionals for update to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()))
  with check (business_id in (select id from public.businesses where owner_id = auth.uid()));
create policy professionals_owner_delete on public.professionals for delete to authenticated
  using (business_id in (select id from public.businesses where owner_id = auth.uid()));

-- Permisos de tabla: el proveedor solo toca columnas propias de la oferta
grant select, insert, update, delete on public.businesses to authenticated;
grant select, insert, update, delete on public.workers to authenticated;
grant insert (servicio, descripcion, precio, duracion_min, horario, disponible, business_id) on public.professionals to authenticated;
grant update (servicio, descripcion, precio, duracion_min, horario, disponible) on public.professionals to authenticated;
grant delete on public.professionals to authenticated;
