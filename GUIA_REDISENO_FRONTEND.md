# PetGo — rediseño visual (sin cambios en backend ni base de datos)

## Cómo revisar

1. Abre el proyecto desde un servidor HTTP local, por ejemplo `python -m http.server 8000` en esta carpeta.
2. Entra a `http://localhost:8000/vista-previa.html`.
3. Accede al comparador de paseos, baños, mascotas, registro o panel de proveedores.

> La vista previa utiliza `?demo=1` y `sessionStorage` para dejar navegar las pantallas sin iniciar sesión. La aplicación original sigue utilizando Supabase para el flujo real ya existente.

## Páginas y cambios

- `resultados-paseos.html` y `resultados-banos.html`: lista de ofertas de un mismo servicio. Filtrar por disponibilidad / tipo de proveedor y ordenar por precio, ubicación o calificación.
- `detalle-paseos.html` y `detalle-banos.html`: tipo de proveedor y estado de disponibilidad. Las ofertas no disponibles impiden iniciar la reserva.
- `mis-mascotas.html`: lista vertical, formulario superior para agregar/editar, foto opcional, selección Perro/Gato, acciones cancelar, guardar y eliminar.
- `registro.html`: elección entre dueños y proveedores; formularios dinámicos para independientes/empresas.
- `proveedor-panel.html`: panel azul verdoso `#0D7377`, edición de ofertas, citas de demostración, empleados y perfil.
- `vista-previa.html`: navegación rápida para revisar diseño sin sesión.
- `js/petgo-extra.js`: interacciones del nuevo panel y selección del tipo de registro.

## Comportamiento de la demostración

- Las ofertas del panel se guardan en `localStorage` bajo `petgo_business_offers` y aparecen en el catálogo de la vista previa.
- Los cambios de mascotas en esta nueva interfaz se guardan localmente, incluidos los cambios visuales a mascotas existentes. **No actualizan ni eliminan las filas existentes en Supabase**.
- El registro de **dueños** conserva su comportamiento original. El registro de **proveedores** es una simulación de perfil local: no crea cuenta de autenticación real.
- Las citas agregadas en el panel son datos de ejemplo introducidos por el usuario y no corresponden a reservas de backend.
- Las reservas reales no se ejecutan durante la vista previa y tampoco se habilitan para ofertas locales sin identificador de proveedor del servidor.
- Las nuevas funciones no tienen sincronización entre navegadores o dispositivos. Las cifras de reseñas de la vista previa son ilustrativas.
- Las páginas no modificadas mantienen su integración original con Supabase y su backend.

## Próxima etapa técnica (fuera del alcance actual)

Conectar tipos de cuenta, ofertas y empleados a tablas y permisos reales; asociar citas a cada proveedor; utilizar una fuente central de disponibilidad; vincular la edición de mascotas con el backend de manera segura.

## Actualización: registro compacto de tres pasos

- Paso 1: elegir entre buscar servicios u ofrecer servicios; para proveedores, elegir independiente o empresa.
- Paso 2: nombre, correo y datos básicos del proveedor (nombre comercial, zona y cantidad de empleados en empresas).
- Paso 3: contraseña y confirmación; botón para completar el registro.
- En escritorio, dos columnas con ilustración lateral; en móvil, la ilustración se oculta para aprovechar el espacio.
- La información no se pierde al retroceder. Los mensajes de validación se muestran en el campo correspondiente.
- Los proveedores siguen utilizando **modo demostración local**, sin crear perfiles en Supabase. Para dueños se conserva el flujo original de autenticación.
- En pantallas demasiado pequeñas o con teclado virtual abierto, puede requerirse desplazamiento por accesibilidad.


## Actualización de PetGo Negocios: menú lateral
- En `proveedor-panel.html` el menú lateral cambia entre **Resumen**, **Mis servicios**, **Mis citas**, **Equipo** y **Mi perfil**; ya no desplaza la página hasta una sección.
- **Equipo** se oculta para proveedores individuales.
- **Mi perfil** presenta la información en modo lectura; pulsa **Editar perfil** para modificarla y **Cancelar** para descartar cambios.
- **Cerrar sesión** redirige al inicio de sesión, limpia el modo de vista previa y, cuando esté disponible, cierra una sesión de Supabase. Los datos de demostración almacenados localmente no se borran.
- En pantallas pequeñas, el menú se despliega desde un botón superior.
- No se modificaron `backend/` ni `supabase/`.
