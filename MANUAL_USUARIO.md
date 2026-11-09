# Manual de usuario — PetGo

Guía rápida para usar la plataforma de reservas de paseos y baños para mascotas.

---

## 1. Primeros pasos

### 1.1 Página de inicio

Al abrir PetGo verás:

- Descripción de los servicios (paseos y baño/peluquería)
- Botones para **Registrarme** o **Iniciar sesión**
- Cómo funciona el proceso en 4 pasos

### 1.2 Crear cuenta

1. Pulsa **Registrarme**.
2. Completa nombre, correo y contraseña (o usa el acceso con Google/Microsoft si está configurado).
3. Al registrarte se crea tu perfil y recibes una notificación de bienvenida.
4. Quedas dentro del **panel (dashboard)**.

### 1.3 Iniciar sesión

1. Pulsa **Iniciar sesión**.
2. Introduce correo y contraseña (o el proveedor OAuth).
3. Si ya tenías sesión abierta, el sistema puede llevarte directo al panel.

---

## 2. Panel principal (Dashboard)

Desde el dashboard puedes:

- Ver un resumen de tu **próxima reserva**
- Acceder rápido a tus **mascotas**
- Ir a **reservar** servicios, ver **mis reservas**, **notificaciones** y **perfil**

La barra superior (navbar) está disponible en casi todas las páginas privadas.

---

## 3. Gestionar mascotas

1. Entra a **Mis mascotas**.
2. Puedes **agregar** una mascota: nombre, especie, raza, edad y foto (opcional).
3. Las mascotas se usan al hacer una reserva (se elige cuál va al servicio).

**Consejo:** registra al menos una mascota antes de reservar para que el flujo sea más rápido.

---

## 4. Reservar un servicio

### 4.1 Elegir tipo de servicio

- **Paseos** → listado de paseadores
- **Baño y peluquería** → listado de bañadores

En los resultados verás nombre, zona, precio, duración, calificación y disponibilidad.

### 4.2 Ver detalle del profesional

Al elegir un profesional se muestra:

- Descripción y detalle del servicio
- Precio y duración
- Horario orientativo
- Botón para **Reservar**

### 4.3 Pasos de la reserva

1. **Elegir mascota** — selecciona una de tus mascotas (o ve a crear una).
2. **Fecha y hora** — elige día y franja (horarios entre 07:00 y 19:00).  
   Si el horario ya está ocupado, el sistema te lo indica.
3. **Confirmación** — revisa servicio, profesional, mascota, fecha, hora y precio. Confirma.

Al confirmar:

- Se crea la reserva en estado **confirmada**
- Recibes una notificación
- Puedes verla en **Mis reservas**

**Límite:** hay un máximo de reservas activas por usuario (definido en la aplicación).

---

## 5. Mis reservas

En **Mis reservas** verás el listado de tus reservas (confirmadas y canceladas).

- Entra al **detalle** de una reserva para ver todos los datos.
- Desde el detalle puedes **cancelar** una reserva confirmada (se abre un modal de confirmación).

Estados habituales:

- **Confirmada** — activa
- **Cancelada** — ya no es válida

---

## 6. Notificaciones

- Icono de campana en la barra superior.
- Lista de avisos (bienvenida, confirmación de reserva, etc.).
- Puedes marcarlas como leídas según la interfaz.

---

## 7. Perfil

En **Perfil** puedes:

- Ver tu nombre, correo, teléfono y ciudad
- Editar nombre, teléfono y ciudad (el correo de la cuenta no se cambia desde aquí)
- Cerrar sesión

---

## 8. Mapa

La página **Mapa** ofrece una vista de referencia geográfica (según la implementación del prototipo).

---

## 9. Mensajes y estados especiales

La aplicación muestra pantallas o avisos cuando, por ejemplo:

- No hay resultados de búsqueda
- No tienes reservas aún
- El horario elegido está ocupado
- Alcanzaste el límite de reservas
- Hay un error en un formulario
- Eres un usuario nuevo sin datos cargados

Lee el mensaje en pantalla y sigue la acción sugerida (volver, cambiar fecha, agregar mascota, etc.).

---

## 10. Cerrar sesión

En **Perfil** (o el control de usuario de la barra) usa la opción de **cerrar sesión**.  
Se limpia la sesión de reserva en curso y vuelves a la zona pública.

---

## 11. Consejos de uso

- Usa un correo real si quieres recuperar acceso o recibir avisos.
- Mantén actualizados los datos de tus mascotas.
- Revisa **Mis reservas** antes de crear otra para no duplicar.
- Si algo no carga, comprueba tu conexión; la app depende de Supabase.

---

## 12. Accesibilidad

En todas las páginas hay un botón flotante **♿** (esquina inferior derecha) con:

- Zoom de texto  
- Alto contraste  
- Lectura en voz alta  

Consulta el [Manual de accesibilidad](MANUAL_ACCESIBILIDAD.md) para el detalle.

---

## Soporte

Si encuentras un error de datos o de reserva, revisa primero:

1. Que estés autenticado  
2. Que la mascota y el horario sean válidos  
3. El panel de Supabase (Table Editor / SQL Editor) si tienes acceso de administración  

Para el equipo de desarrollo: ver `README.md` y `supabase/schema.sql`.
