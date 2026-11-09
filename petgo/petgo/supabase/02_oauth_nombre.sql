-- Para entrar con Google/Microsoft: toma el nombre que envía el proveedor.
-- Pégalo en Supabase → SQL Editor → Run. (Solo reemplaza la función; no toca datos.)
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
