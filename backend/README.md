# API de PetGo

API propia (Node.js 20+, **sin dependencias externas**) que se interpone entre el sitio web y la base de datos.
Supabase sigue siendo la base de datos (PostgreSQL) y el sistema de cuentas (correo, Google, verificación en dos pasos);
esta API aplica sus propias validaciones y reglas, y es la única puerta de acceso a los datos cuando el sitio la usa.

```
Navegador ──(inicio de sesión)──────────────► Supabase Auth
    │
    └─(token del usuario)─► API de PetGo ──(mismo token)──► Supabase (PostgreSQL + RLS)
```

## Cómo se protege
- **Cada petición lleva el token del usuario.** La API lo comprueba con Supabase Auth y lo reenvía a la base de datos,
  así las reglas RLS y los triggers de `supabase/schema.sql` siguen aplicándose (defensa en dos capas).
- **No se usa ninguna clave secreta.** La API solo necesita la clave pública `sb_publishable_...`;
  si se configura una `sb_secret_...` por error, la API se niega a arrancar.
- Validación estricta de cada campo (tipos, largos, fechas reales, horario 07:00–19:00, campos no permitidos).
  El cliente no puede fijar precio, duración, dueño ni estado: los decide la base de datos.
- CORS con lista de sitios permitidos, límite de peticiones por IP, tamaño máximo de cuerpo (64 KB),
  cabeceras de seguridad y mensajes de error que no filtran detalles internos.

## Endpoints
Todos devuelven JSON. Los errores tienen la forma `{ "error": { "code": "...", "message": "..." } }`.
Salvo los marcados, requieren `Authorization: Bearer <token de Supabase>`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del servicio (público) |
| GET / PATCH | `/api/me` | Ver / actualizar perfil (`nombre`, `telefono`, `ciudad`) |
| GET / POST | `/api/pets` | Listar / crear mascota (`nombre`, `especie`, `raza`, `edad`, `foto_path`) |
| DELETE | `/api/pets/:id` | Eliminar mascota |
| GET | `/api/professionals?servicio=paseo\|bano` | Catálogo (público) |
| GET | `/api/professionals/:id` | Un profesional (público) |
| GET | `/api/availability?professional=<id>&fecha=AAAA-MM-DD` | Horas ocupadas ese día |
| GET / POST | `/api/bookings` | Listar / crear reserva (`professional_id`, `pet_id`, `fecha`, `hora`) |
| PATCH | `/api/bookings/:id` | Reprogramar (`fecha` y/o `hora`) |
| POST | `/api/bookings/:id/cancel` | Cancelar (idempotente) |
| GET | `/api/notifications` | Listar notificaciones |
| PATCH | `/api/notifications/:id` | Marcar una como leída (`{"leida": true}`) |
| POST | `/api/notifications/read-all` | Marcar todas como leídas |

Códigos de error de negocio: `horario_ocupado` (409), `limite_reservas` (409), `fecha_pasada` (422),
`reserva_cancelada` (409), `profesional_no_disponible` (404), `mascota_no_encontrada` (404),
`sesion_invalida` / `sin_sesion` (401), `datos_invalidos` (400), `demasiadas_peticiones` (429).

## Probarla en tu computador
Necesitas [Node.js 20 o superior](https://nodejs.org).

```bash
cd backend
cp .env.example .env        # en Windows: copy .env.example .env   y edita SUPABASE_KEY
node server.js              # http://localhost:3000/api/health
node --test                 # pruebas automáticas (usan un Supabase simulado, no tocan tu base)
```

Para que el sitio use tu API local, en `js/supabase-config.js` pon `window.PETGO_API_URL = "http://localhost:3000";`
y añade el origen desde donde abras el sitio (por ejemplo `http://localhost:5500`) a `ALLOWED_ORIGINS`.

## Publicarla en Render (gratis)
1. Sube el repositorio a GitHub con la carpeta `backend/`.
2. En [render.com](https://render.com) entra con GitHub → **New → Blueprint** (o **Web Service**) y elige el repositorio.
   - Con Blueprint se lee `backend/render.yaml`. Con Web Service pon: **Root Directory** `backend`,
     **Build Command** `echo ok`, **Start Command** `node server.js`, **Health Check Path** `/api/health`.
3. Variables de entorno (**Environment**):
   - `SUPABASE_URL` = `https://ylrbqjnxqdeatvqduqrc.supabase.co`
   - `SUPABASE_KEY` = tu clave `sb_publishable_...`
   - `ALLOWED_ORIGINS` = las direcciones de tu sitio, separadas por coma y sin barra final
   - `TRUST_PROXY` = `true`
4. Cuando termine, abre `https://TU-SERVICIO.onrender.com/api/health`: debe responder `{"ok":true,...}`.
5. En `js/supabase-config.js` pon `window.PETGO_API_URL = "https://TU-SERVICIO.onrender.com";`, sube el cambio y recarga el sitio.

Nota: en el plan gratis Render "duerme" el servicio tras un rato sin uso; la primera petición después puede tardar
unos 30–60 segundos en responder.

## Estructura
```
backend/
  server.js          arranque y configuración
  src/config.js      variables de entorno
  src/http.js        servidor, CORS, límite de peticiones, JSON
  src/supa.js        cliente de Supabase (Auth + PostgREST) y traducción de errores
  src/validate.js    validaciones de entrada
  src/routes.js      endpoints
  test/              Supabase simulado + pruebas automáticas
```
