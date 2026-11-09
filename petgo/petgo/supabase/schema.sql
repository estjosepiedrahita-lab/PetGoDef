-- =====================================================================
-- PetGo · esquema inicial de base de datos (Supabase / PostgreSQL)
-- Pégalo completo en Supabase → SQL Editor → Run. Se puede ejecutar más
-- de una vez sin romper nada (usa "if not exists" / "or replace").
-- =====================================================================

-- ---------- 1. TABLAS ------------------------------------------------

-- Perfil de cada usuario (1 a 1 con auth.users)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null default '',
  correo     text,
  telefono   text not null default '',
  ciudad     text not null default 'Bogotá',
  created_at timestamptz not null default now()
);

-- Mascotas
create table if not exists public.pets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  especie    text not null default 'Perro',
  raza       text,
  edad       text,
  foto_path  text,                       -- ruta dentro del bucket pet-photos
  created_at timestamptz not null default now()
);
create index if not exists pets_user_idx on public.pets(user_id);

-- Catálogo de profesionales (lo lee todo el mundo, solo se edita desde el panel)
create table if not exists public.professionals (
  id           text primary key,         -- slug, p. ej. 'happy-walk' (coincide con assets/img/pro-<slug>.jpg)
  servicio     text not null check (servicio in ('paseo', 'bano')),
  nombre       text not null,
  zona         text not null,
  descripcion  text not null,
  detalle      text,
  precio       integer not null check (precio > 0),
  duracion_min integer not null check (duracion_min > 0),
  rating       numeric(2,1) not null default 0,
  resenas      integer not null default 0,
  horario      text,
  activo       boolean not null default true
);

-- Reservas
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  professional_id text not null references public.professionals(id),
  pet_id          uuid references public.pets(id) on delete set null,
  pet_nombre      text not null,         -- se conserva aunque se borre la mascota
  servicio        text not null,         -- copia del catálogo al reservar
  precio          integer not null,      -- copia del catálogo al reservar
  duracion_min    integer not null,      -- copia del catálogo al reservar
  fecha           date not null,
  hora            time not null check (hora between time '07:00' and time '19:00'),
  estado          text not null default 'confirmada' check (estado in ('confirmada', 'cancelada')),
  created_at      timestamptz not null default now()
);
create index if not exists bookings_user_idx on public.bookings(user_id, estado);

-- Un profesional no puede tener dos reservas activas a la misma fecha y hora
create unique index if not exists bookings_slot_unico
  on public.bookings(professional_id, fecha, hora) where estado = 'confirmada';

-- Notificaciones
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  texto      text not null,
  leida      boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ---------- 2. REGLAS Y AUTOMATISMOS (triggers) ----------------------

-- 2.1 Al registrarse: crear perfil y notificación de bienvenida
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, nombre, correo)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data ->> 'nombre', ''),
                   nullif(new.raw_user_meta_data ->> 'full_name', ''),
                   nullif(new.raw_user_meta_data ->> 'name', ''), ''),
          new.email)
  on conflict (id) do nothing;
  insert into public.notifications (user_id, texto)
  values (new.id, '¡Bienvenido a PetGo! Reserva tu primer servicio.');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2.2 Antes de insertar una reserva: dueño, precio/duración desde el catálogo,
--     fecha no pasada y máximo 5 pendientes
create or replace function public.bookings_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.professionals%rowtype;
begin
  new.user_id := auth.uid();
  new.estado  := 'confirmada';

  select * into p from public.professionals where id = new.professional_id and activo;
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

drop trigger if exists bookings_bi on public.bookings;
create trigger bookings_bi before insert on public.bookings
  for each row execute function public.bookings_before_insert();

-- 2.3 Al actualizar una reserva: solo se pueden cambiar estado, fecha y hora
--     (y una cancelada no se puede reactivar)
create or replace function public.bookings_before_update()
returns trigger language plpgsql as $$
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
  return new;
end $$;

drop trigger if exists bookings_bu on public.bookings;
create trigger bookings_bu before update on public.bookings
  for each row execute function public.bookings_before_update();

-- 2.4 Notificaciones automáticas por cambios en reservas
create or replace function public.bookings_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, texto)
    values (new.user_id, 'Tu reserva ha sido confirmada.');
  elsif new.estado = 'cancelada' and old.estado = 'confirmada' then
    insert into public.notifications (user_id, texto)
    values (new.user_id, 'Tu reserva fue cancelada.');
  elsif new.estado = 'confirmada' and (new.fecha <> old.fecha or new.hora <> old.hora) then
    insert into public.notifications (user_id, texto)
    values (new.user_id, 'Tu reserva fue reprogramada para el ' || to_char(new.fecha, 'DD/MM/YYYY')
                         || ' a las ' || to_char(new.hora, 'HH12:MI AM') || '.');
  end if;
  return new;
end $$;

drop trigger if exists bookings_notify_t on public.bookings;
create trigger bookings_notify_t after insert or update on public.bookings
  for each row execute function public.bookings_notify();

-- 2.5 Horas ocupadas de un profesional en una fecha (de cualquier usuario),
--     sin exponer datos personales
create or replace function public.slots_ocupados(p_professional text, p_fecha date)
returns setof time language sql stable security definer set search_path = '' as $$
  select hora from public.bookings
  where professional_id = p_professional and fecha = p_fecha and estado = 'confirmada';
$$;
revoke all on function public.slots_ocupados(text, date) from public;
grant execute on function public.slots_ocupados(text, date) to authenticated;

-- ---------- 3. SEGURIDAD POR FILA (RLS) ------------------------------
alter table public.profiles      enable row level security;
alter table public.pets          enable row level security;
alter table public.professionals enable row level security;
alter table public.bookings      enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists pets_all on public.pets;
create policy pets_all on public.pets for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists professionals_select on public.professionals;
create policy professionals_select on public.professionals for select to anon, authenticated using (activo);

drop policy if exists bookings_select on public.bookings;
drop policy if exists bookings_insert on public.bookings;
drop policy if exists bookings_update on public.bookings;
create policy bookings_select on public.bookings for select to authenticated using (user_id = auth.uid());
create policy bookings_insert on public.bookings for insert to authenticated with check (user_id = auth.uid());
create policy bookings_update on public.bookings for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_select on public.notifications;
drop policy if exists notifications_update on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Permisos de tabla (RLS decide qué filas ve cada quien)
grant select on public.professionals to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.pets to authenticated;
grant select, insert, update on public.bookings to authenticated;
grant select, update on public.notifications to authenticated;

-- ---------- 4. FOTOS DE MASCOTAS (Storage) ---------------------------
insert into storage.buckets (id, name, public)
values ('pet-photos', 'pet-photos', true)
on conflict (id) do nothing;

drop policy if exists pet_photos_insert on storage.objects;
drop policy if exists pet_photos_update on storage.objects;
drop policy if exists pet_photos_delete on storage.objects;
-- cada usuario solo escribe dentro de su carpeta: <user_id>/archivo.jpg
create policy pet_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pet_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pet_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pet-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 5. CATÁLOGO INICIAL -------------------------------------
insert into public.professionals (id, servicio, nombre, zona, descripcion, detalle, precio, duracion_min, rating, resenas, horario) values
 ('paseos-petgo',  'paseo', 'Paseos PetGo',     'Chapinero', 'Paseos profesionales con seguimiento GPS en tiempo real.',
  'Paseos profesionales con seguimiento GPS en tiempo real. Rutas seguras y diversión garantizada.', 20000, 30, 4.9, 128, 'Lun–Sáb, 7:00 AM – 7:00 PM'),
 ('happy-walk',    'paseo', 'Happy Walk',       'Usaquén',   'Paseos personalizados con seguimiento durante el servicio.',
  'Paseos personalizados para perros, con seguimiento durante el servicio. Rutas seguras y diversión garantizada.', 18000, 30, 4.8, 96, 'Lun–Sáb, 7:00 AM – 7:00 PM'),
 ('patitas-felices','paseo','Patitas Felices',  'Suba',      'Paseos grupales e individuales con cuidadores certificados.',
  'Paseos grupales e individuales con cuidadores certificados.', 22000, 45, 4.7, 74, 'Lun–Sáb, 7:00 AM – 7:00 PM'),
 ('petgo-grooming','bano',  'PetGo Grooming',   'Chapinero', 'Baño, secado y corte con productos hipoalergénicos.',
  'Baño, secado y corte con productos hipoalergénicos. Tu mascota queda limpia, cómoda y feliz.', 35000, 90, 4.9, 142, 'Lun–Sáb, 8:00 AM – 6:00 PM'),
 ('spa-canino-bogota','bano','Spa Canino Bogotá','Usaquén',  'Spa completo: baño, corte, limpieza de oídos y uñas.',
  'Spa completo: baño, corte, limpieza de oídos y uñas.', 48000, 120, 4.8, 88, 'Lun–Sáb, 8:00 AM – 6:00 PM'),
 ('patas-limpias', 'bano',  'Patas Limpias',    'Suba',      'Baño y peluquería a domicilio para perros pequeños.',
  'Baño y peluquería a domicilio para perros pequeños.', 30000, 60, 4.6, 51, 'Lun–Sáb, 8:00 AM – 6:00 PM')
on conflict (id) do nothing;
