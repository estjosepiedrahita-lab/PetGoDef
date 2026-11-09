# Manual de base de datos — PetGo

Este documento describe el esquema de Supabase/PostgreSQL usado por PetGo: tablas, relaciones, reglas de negocio, seguridad (RLS), almacenamiento y cómo desplegar o consultar los datos.

El código fuente del esquema está en `supabase/schema.sql` (y el ajuste de nombre OAuth en `supabase/02_oauth_nombre.sql`).

---

## 1. Cómo aplicar el esquema

1. Entra al proyecto en [Supabase](https://supabase.com) → **SQL Editor**.
2. Pega el contenido completo de `supabase/schema.sql` y ejecuta (**Run**).
3. El script es idempotente: usa `if not exists` / `or replace` / `drop ... if exists`, así que puedes reejecutarlo sin romper datos existentes.
4. (Opcional) Si usas login con Google/Microsoft, ejecuta también `supabase/02_oauth_nombre.sql` para rellenar el nombre del perfil desde los metadatos OAuth.

En el front solo debe ir la **URL del proyecto** y la **clave publishable** (`js/supabase-config.js`). Nunca expongas la service role ni la contraseña de la base.

---

## 2. Diagrama lógico (resumen)

```
auth.users (Supabase Auth)
    │ 1:1
    ▼
profiles ──────────────┐
    │                  │
    │ 1:N              │ 1:N
    ▼                  ▼
  pets            notifications
    │
    │ (opcional en reserva)
    ▼
bookings ◄──── professionals (catálogo público)
```

- Cada usuario de Auth tiene un perfil.
- Las mascotas y notificaciones pertenecen al usuario.
- Las reservas apuntan a un profesional del catálogo y, si existe, a una mascota; el nombre de la mascota se guarda también en la reserva por si se borra después.

---

## 3. Tablas

### 3.1 `public.profiles`

Perfil 1:1 con `auth.users`.

| Columna     | Tipo         | Descripción                          |
|-------------|--------------|--------------------------------------|
| `id`        | uuid PK      | = `auth.users.id`                    |
| `nombre`    | text         | Nombre visible                       |
| `correo`    | text         | Email (copia al registrarse)         |
| `telefono`  | text         | Teléfono                             |
| `ciudad`    | text         | Por defecto `Bogotá`                 |
| `created_at`| timestamptz  | Alta del perfil                      |

**Trigger:** al insertar en `auth.users`, `handle_new_user()` crea el perfil y una notificación de bienvenida.

### 3.2 `public.pets`

Mascotas del usuario.

| Columna     | Tipo         | Descripción                                      |
|-------------|--------------|--------------------------------------------------|
| `id`        | uuid PK      | Generado automáticamente                         |
| `user_id`   | uuid         | Dueño (`auth.uid()`)                             |
| `nombre`    | text         | Obligatorio (no vacío)                           |
| `especie`   | text         | Por defecto `Perro`                              |
| `raza`      | text         | Opcional                                         |
| `edad`      | text         | Texto libre                                      |
| `foto_path` | text         | Ruta en el bucket `pet-photos`                   |
| `created_at`| timestamptz  | Alta                                             |

Índice: `pets_user_idx` sobre `user_id`.

### 3.3 `public.professionals`

Catálogo de paseadores y bañadores (solo lectura para la app).

| Columna         | Tipo        | Descripción                                      |
|-----------------|-------------|--------------------------------------------------|
| `id`            | text PK     | Slug, p. ej. `happy-walk`                        |
| `servicio`      | text        | `paseo` o `bano`                                 |
| `nombre`        | text        | Nombre comercial                                 |
| `zona`          | text        | Barrio / zona                                    |
| `descripcion`   | text        | Texto corto                                      |
| `detalle`       | text        | Texto largo                                      |
| `precio`        | integer     | COP, > 0                                         |
| `duracion_min`  | integer     | Minutos, > 0                                     |
| `rating`        | numeric     | Promedio                                         |
| `resenas`       | integer     | Cantidad de reseñas                              |
| `horario`       | text        | Texto legible del horario                        |
| `activo`        | boolean     | Si es `false`, no se muestra ni se puede reservar|

El `schema.sql` inserta un catálogo inicial (paseos y baños en Chapinero, Usaquén, Suba).

### 3.4 `public.bookings`

Reservas del usuario.

| Columna           | Tipo        | Descripción                                           |
|-------------------|-------------|-------------------------------------------------------|
| `id`              | uuid PK     | Generado automáticamente                              |
| `user_id`         | uuid        | Dueño de la reserva                                   |
| `professional_id` | text        | FK a `professionals`                                  |
| `pet_id`          | uuid        | FK opcional a `pets` (se pone null si se borra la mascota) |
| `pet_nombre`      | text        | Nombre conservado aunque se elimine la mascota        |
| `servicio`        | text        | Copia al reservar (`Paseo` / `Baño y peluquería`)     |
| `precio`          | integer     | Copia del catálogo al reservar                        |
| `duracion_min`    | integer     | Copia del catálogo al reservar                        |
| `fecha`           | date        | Día del servicio                                      |
| `hora`            | time        | Entre 07:00 y 19:00                                   |
| `estado`          | text        | `confirmada` o `cancelada`                            |
| `created_at`      | timestamptz | Creación                                              |

Índices:

- `bookings_user_idx` (`user_id`, `estado`)
- `bookings_slot_unico`: un profesional no puede tener dos reservas **confirmadas** en la misma fecha y hora.

### 3.5 `public.notifications`

| Columna      | Tipo        | Descripción        |
|--------------|-------------|--------------------|
| `id`         | uuid PK     |                    |
| `user_id`    | uuid        | Destinatario       |
| `texto`      | text        | Mensaje            |
| `leida`      | boolean     | Por defecto false  |
| `created_at` | timestamptz |                    |

Índice: `notifications_user_idx` (`user_id`, `created_at` desc).

---

## 4. Reglas de negocio (triggers y funciones)

| Momento                         | Función / efecto |
|---------------------------------|------------------|
| Nuevo usuario en Auth           | Crea `profiles` + notificación de bienvenida |
| Antes de insertar reserva       | Fija `user_id` y `estado = confirmada`; copia servicio, precio y duración del profesional; rechaza fecha pasada (`FECHA_PASADA`); máximo 5 reservas confirmadas (`LIMITE_RESERVAS`); profesional debe existir y estar activo (`PROFESIONAL_NO_DISPONIBLE`) |
| Antes de actualizar reserva     | No se pueden cambiar dueño, profesional, mascota, precio, etc.; una cancelada no se reactiva (`RESERVA_CANCELADA`) |
| Después de insert/update reserva| Notificaciones: confirmada, cancelada o reprogramada |
| Consulta de huecos              | RPC `slots_ocupados(profesional, fecha)` → lista de `time` ocupados (solo autenticados) |

Conflicto de horario duplicado: el índice único produce error de clave (`23505`); la app redirige a `estado-horario-ocupado.html`.

---

## 5. Seguridad (Row Level Security)

Todas las tablas de negocio tienen RLS activado.

| Tabla            | Quién puede qué |
|------------------|-----------------|
| `profiles`       | El dueño lee y actualiza solo su fila |
| `pets`           | CRUD solo de sus mascotas |
| `professionals`  | Lectura pública (`anon` y `authenticated`) de filas con `activo = true`. Sin políticas de escritura para clientes |
| `bookings`       | Select/insert/update solo de sus reservas |
| `notifications`  | Select y update (marcar leídas) solo de las propias |

La función `slots_ocupados` es `security definer` y solo expone horas, no datos de otros usuarios.

---

## 6. Almacenamiento (fotos de mascotas)

- Bucket: `pet-photos` (público en lectura según el schema).
- Políticas: el usuario autenticado solo puede subir/actualizar/borrar archivos cuya primera carpeta sea su `user_id` (`<uid>/archivo.jpg`).
- En `pets.foto_path` se guarda esa ruta relativa.

---

## 7. Consultas útiles (SQL Editor)

```sql
-- Perfiles
select * from public.profiles order by created_at desc limit 20;

-- Mascotas de un usuario
select * from public.pets where user_id = '<uuid>';

-- Catálogo activo
select id, servicio, nombre, zona, precio from public.professionals where activo;

-- Reservas confirmadas próximas
select b.*, p.nombre as pro
from public.bookings b
join public.professionals p on p.id = b.professional_id
where b.estado = 'confirmada' and b.fecha >= current_date
order by b.fecha, b.hora;

-- Horas ocupadas (equivalente al RPC)
select * from public.slots_ocupados('happy-walk', '2026-10-28');

-- Notificaciones no leídas
select * from public.notifications
where user_id = auth.uid() and leida = false
order by created_at desc;
```

Para probar como un usuario concreto desde el SQL Editor hace falta impersonar o usar el cliente con su JWT; `auth.uid()` solo tiene valor en peticiones autenticadas.

---

## 8. Errores que devuelve la base (y pantallas de la app)

| Código / mensaje SQL     | Pantalla / comportamiento típico      |
|--------------------------|----------------------------------------|
| `FECHA_PASADA`           | Validación en cliente / error genérico |
| `LIMITE_RESERVAS`        | `estado-limite-de-reservas.html`       |
| `PROFESIONAL_NO_DISPONIBLE` | Error al confirmar                   |
| `RESERVA_CANCELADA`      | No se puede reactivar desde la app     |
| `23505` / slot único     | `estado-horario-ocupado.html`          |

---

## 9. Buenas prácticas

- No borres ni desactives políticas RLS sin sustituirlas: dejaría las tablas abiertas o inaccesibles.
- Los precios y duraciones de las reservas son **copias** del catálogo en el momento de reservar; cambiar el catálogo no altera reservas ya hechas.
- Para “despublicar” un profesional, pon `activo = false` en lugar de borrar la fila (las reservas antiguas siguen referenciando el `id`).
- Haz copias de seguridad desde el panel de Supabase antes de cambios grandes en el schema.
- Revisa logs de Auth y de la API si el front muestra “No se pudieron cargar tus datos”.

---

## 10. Relación con el front

| Dato / acción              | Origen en BD / API                          |
|----------------------------|---------------------------------------------|
| Login / registro           | Supabase Auth → trigger → `profiles`        |
| Nombre en navbar           | `profiles.nombre`                           |
| Listado de mascotas        | `pets`                                      |
| Resultados paseo/baño      | `professionals` filtrado por `servicio`     |
| Calendario / slots         | RPC `slots_ocupados` + UI local             |
| Confirmar reserva          | `insert` en `bookings`                      |
| Mis reservas / cancelar    | `bookings` + `update` estado                |
| Campana de notificaciones  | `notifications`                             |

Con esto puedes mantener, auditar y extender la base de datos de PetGo de forma segura y alineada con la aplicación.
