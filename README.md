# PetGo

Plataforma web para reservar servicios de **paseos** y **baño/peluquería** para mascotas en Bogotá, con profesionales verificados.

## Características

- Registro e inicio de sesión (email y OAuth)
- Gestión de mascotas (alta, edición, foto)
- Búsqueda y reserva de paseos y baños
- Calendario de disponibilidad y confirmación de reserva
- Panel de reservas, notificaciones y perfil
- **Accesibilidad**: zoom de texto, alto contraste y lectura en voz alta

## Estructura del proyecto

```
PetGo/
├── index.html              # Página de inicio (pública)
├── login.html / registro.html
├── dashboard.html          # Panel del usuario
├── resultados-paseos.html / resultados-banos.html
├── detalle-paseos.html / detalle-banos.html
├── reserva-mascota.html / reserva-fecha-y-hora.html / reserva-confirmacion.html
├── mis-reservas.html / detalle-de-reserva.html
├── mis-mascotas.html
├── notificaciones.html
├── perfil.html
├── mapa.html
├── css/styles.css          # Estilos compartidos + accesibilidad
├── js/
│   ├── app.js              # Lógica de la app + módulo de accesibilidad
│   └── supabase-config.js  # URL y clave pública de Supabase
├── data/                   # Datos de apoyo (JSON)
├── assets/                 # Imágenes e iconos
├── supabase/
│   ├── schema.sql          # Esquema de base de datos (tablas, RLS, triggers)
│   └── 02_oauth_nombre.sql # Ajuste de nombre con OAuth
├── README.md
├── MANUAL_USUARIO.md
├── MANUAL_ACCESIBILIDAD.md
└── MANUAL_BASE_DATOS.md    # Esquema Supabase, tablas, RLS y reglas
```

## Requisitos

- Navegador moderno (Chrome, Edge, Firefox, Safari)
- Proyecto en [Supabase](https://supabase.com) con el esquema de `supabase/schema.sql` aplicado
- Configuración en `js/supabase-config.js` (URL y clave *publishable*)

## Puesta en marcha (local)

1. Clona el repositorio y entra a la carpeta del proyecto.
2. Sirve los archivos con cualquier servidor estático, por ejemplo:

   ```bash
   npx serve .
   # o
   python -m http.server 8080
   ```

3. Abre en el navegador la URL que indique el servidor (ej. `http://localhost:8080`).
4. Asegúrate de que el proyecto Supabase tenga ejecutado `schema.sql` y, si usas Google/Microsoft, también `02_oauth_nombre.sql`.

> **Importante:** no subas ni expongas la clave secreta de Supabase (`sb_secret_...`) ni la contraseña de la base de datos. Solo la clave *publishable* va en el front.

## Base de datos (Supabase)

Tablas principales:

| Tabla            | Uso                                      |
|------------------|------------------------------------------|
| `profiles`       | Perfil del usuario                       |
| `pets`           | Mascotas                                 |
| `professionals`  | Catálogo de paseadores / bañadores       |
| `bookings`       | Reservas                                 |
| `notifications`  | Notificaciones                           |

Documentación completa (esquema, triggers, RLS, storage y consultas): **[MANUAL_BASE_DATOS.md](MANUAL_BASE_DATOS.md)**.

Para revisar datos: Dashboard de Supabase → **Table Editor** o **SQL Editor**.

## Accesibilidad

Botón flotante ♿ en todas las páginas. Incluye:

- Zoom de texto (90 % – 150 %)
- Alto contraste
- Lectura en voz alta del contenido de la página

Detalle en [MANUAL_ACCESIBILIDAD.md](MANUAL_ACCESIBILIDAD.md).

## Documentación

- [Manual de usuario](MANUAL_USUARIO.md) — cómo usar la aplicación
- [Manual de accesibilidad](MANUAL_ACCESIBILIDAD.md) — opciones de accesibilidad
- [Manual de base de datos](MANUAL_BASE_DATOS.md) — tablas, RLS, triggers y consultas

## Rama de trabajo

Los cambios de accesibilidad se desarrollan en la rama `accesibilidad`.

```bash
git checkout accesibilidad
```

## Licencia / autoría

Proyecto PetGo — prototipo académico / de producto.  
© 2026 PetGo.
