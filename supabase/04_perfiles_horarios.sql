-- =====================================================================
-- PetGo · 04 · Fotos, dirección, teléfono, horarios y descripción de mascotas
-- Requiere schema.sql y 03_proveedores.sql. Se puede ejecutar más de una vez.
-- ATENCIÓN: al final borra las empresas de ejemplo y las reservas hechas con ellas.
-- =====================================================================

-- ---------- 1. Mascotas: descripción ---------------------------------
alter table public.pets add column if not exists descripcion text not null default '';
alter table public.pets drop constraint if exists pets_descripcion_len;
alter table public.pets add constraint pets_descripcion_len check (length(descripcion) <= 500);

-- ---------- 2. Foto de perfil del usuario -----------------------------
alter table public.profiles add column if not exists foto_path text;
revoke update on public.profiles from authenticated;
grant update (nombre, telefono, ciudad, foto_path) on public.profiles to authenticated;

-- ---------- 3. Negocio: dirección, teléfono y foto --------------------
alter table public.businesses add column if not exists direccion text not null default '';
alter table public.businesses add column if not exists telefono  text not null default '';
alter table public.businesses add column if not exists foto_path text;
alter table public.businesses drop constraint if exists businesses_contacto_len;
alter table public.businesses add constraint businesses_contacto_len check (length(direccion) <= 160 and length(telefono) <= 30);

alter table public.workers add column if not exists foto_path text;

-- ---------- 4. Oferta: copia pública de los datos del negocio + horario
alter table public.professionals add column if not exists direccion   text not null default '';
alter table public.professionals add column if not exists telefono    text not null default '';
alter table public.professionals add column if not exists foto_path   text;
alter table public.professionals add column if not exists dias        smallint[];      -- 0 = domingo ... 6 = sábado
alter table public.professionals add column if not exists hora_inicio time;
alter table public.professionals add column if not exists hora_fin    time;

-- Ofertas ya publicadas: horario por defecto Lun–Sáb 8:00–18:00 (el proveedor puede cambiarlo desde su panel)
update public.professionals
   set dias = '{1,2,3,4,5,6}', hora_inicio = '08:00', hora_fin = '18:00'
 where business_id is not null and (dias is null or hora_inicio is null or hora_fin is null);

alter table public.professionals drop constraint if exists professionals_horario_valido;
alter table public.professionals add constraint professionals_horario_valido check (
  business_id is null or (
    dias is not null and cardinality(dias) between 1 and 7
    and hora_inicio is not null and hora_fin is not null
    and hora_inicio >= time '07:00' and hora_fin <= time '20:00' and hora_fin > hora_inicio));

grant insert (dias, hora_inicio, hora_fin) on public.professionals to authenticated;
grant update (dias, hora_inicio, hora_fin) on public.professionals to authenticated;

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
  -- Las empresas y los servicios de baño necesitan un local al que llevar la mascota
  if (tg_op = 'INSERT' or new.servicio <> old.servicio)
     and (b.tipo = 'empresa' or new.servicio = 'bano') and length(trim(b.direccion)) = 0 then
    raise exception 'DIRECCION_REQUERIDA';
  end if;
  new.nombre := b.nombre; new.zona := b.zona; new.tipo := b.tipo;
  new.direccion := b.direccion; new.telefono := b.telefono; new.foto_path := b.foto_path;
  new.trabajadores := case when b.tipo = 'empresa' then b.cantidad else 1 end;
  new.detalle := new.descripcion;
  return new;
end $$;

create or replace function public.business_sync_offers()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.professionals
     set nombre = new.nombre, zona = new.zona, tipo = new.tipo,
         direccion = new.direccion, telefono = new.telefono, foto_path = new.foto_path,
         trabajadores = case when new.tipo = 'empresa' then new.cantidad else 1 end
   where business_id = new.id;
  return new;
end $$;

-- Los negocios ya existentes copian sus datos a sus ofertas
update public.professionals o
   set direccion = b.direccion, telefono = b.telefono, foto_path = b.foto_path
  from public.businesses b where o.business_id = b.id;

-- ---------- 5. Reservas: respetar el horario del proveedor -------------
create or replace function public.check_horario(p public.professionals, f date, h time)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p.dias is null or p.hora_inicio is null then return; end if;   -- sin horario definido: sin restricción
  if not (extract(dow from f)::smallint = any (p.dias))
     or h < p.hora_inicio
     or (extract(epoch from h) / 60 + p.duracion_min) > extract(epoch from p.hora_fin) / 60 then
    raise exception 'FUERA_DE_HORARIO';
  end if;
end $$;

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
  perform public.check_horario(p, new.fecha, new.hora);

  if (select count(*) from public.bookings
      where user_id = new.user_id and estado = 'confirmada') >= 5 then
    raise exception 'LIMITE_RESERVAS';
  end if;
  return new;
end $$;

create or replace function public.bookings_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.professionals%rowtype;
begin
  new.user_id := old.user_id;
  new.professional_id := old.professional_id;
  new.pet_id := old.pet_id;
  new.pet_nombre := old.pet_nombre;
  new.servicio := old.servicio;
  new.precio := old.precio;
  new.duracion_min := old.duracion_min;
  new.created_at := old.created_at;
  if old.estado = 'cancelada' and new.estado <> 'cancelada' then
    raise exception 'RESERVA_CANCELADA';
  end if;
  if new.estado = 'confirmada' and (new.fecha <> old.fecha or new.hora <> old.hora) then
    select * into p from public.professionals where id = new.professional_id;
    if found then perform public.check_horario(p, new.fecha, new.hora); end if;
  end if;
  return new;
end $$;

-- ---------- 6. Trabajadores visibles públicamente -----------------------
-- Cualquiera puede ver el equipo de un negocio que tiene servicios publicados
drop policy if exists workers_public_select on public.workers;
create policy workers_public_select on public.workers for select to anon, authenticated
  using (business_id in (select business_id from public.professionals where business_id is not null and activo));
grant select on public.workers to anon;

-- ---------- 7. Fotos de perfil, de negocio y de equipo (Storage) --------
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

drop policy if exists profile_photos_insert on storage.objects;
drop policy if exists profile_photos_update on storage.objects;
drop policy if exists profile_photos_delete on storage.objects;
create policy profile_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy profile_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy profile_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 8. Reservas: dirección y teléfono visibles para el cliente ---
-- (se leen desde professionals con el embed; no hace falta cambio de esquema)

-- ---------- 9. Quitar las empresas de ejemplo ---------------------------
-- Desde ahora solo existen proveedores registrados de verdad.
delete from public.bookings where professional_id in (select id from public.professionals where business_id is null);
delete from public.professionals where business_id is null;
