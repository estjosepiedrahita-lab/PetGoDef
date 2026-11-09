# Manual de accesibilidad — PetGo

Este documento describe las opciones de accesibilidad disponibles en PetGo y cómo usarlas.

---

## 1. Cómo abrir el panel

En **todas las páginas** de la aplicación hay un botón flotante con el símbolo **♿** en la esquina inferior derecha.

1. Haz clic (o púlsalo con teclado si está enfocado).
2. Se abre el panel **Accesibilidad**.
3. Para cerrarlo: vuelve a pulsar el botón ♿, haz clic fuera del panel o pulsa la tecla **Escape**.

El panel **no** cambia de tamaño cuando usas el zoom de texto: está pensado para que los controles sigan siendo legibles y usables.

---

## 2. Zoom de texto (tamaño del texto)

**Qué hace:** aumenta o reduce el tamaño del texto y del contenido principal de la página.

**Cómo usarlo:**

| Control | Acción              |
|---------|---------------------|
| **A−**  | Reducir tamaño      |
| **A+**  | Aumentar tamaño     |
| Indicador (ej. 100 %) | Nivel actual |

**Niveles disponibles:** 90 %, 100 %, 115 %, 130 %, 150 %.

**Notas importantes:**

- El zoom se aplica al contenido de la página (textos, botones, tarjetas, etc.).
- **No** se aplica al propio panel de accesibilidad, para que siempre puedas manejar los controles con comodidad.
- La preferencia se guarda en el navegador (`localStorage`) y se mantiene al cambiar de página o recargar.

---

## 3. Alto contraste

**Qué hace:** activa una combinación de colores con mayor contraste (texto más oscuro, fondos más claros, bordes más definidos) para mejorar la legibilidad.

**Cómo usarlo:**

1. En el panel, localiza **Alto contraste**.
2. Activa o desactiva el interruptor (switch).
3. El cambio se aplica de inmediato a toda la interfaz.

**Notas:**

- Compatible con el zoom de texto: puedes usar ambos a la vez.
- También se guarda en el navegador y se restaura en visitas siguientes.

---

## 4. Lectura en voz alta

**Qué hace:** lee en voz alta el contenido principal de la página usando la síntesis de voz del navegador (en español).

**Cómo usarlo:**

1. Abre el panel de accesibilidad.
2. Pulsa **Leer página**.
3. El sistema leerá el texto visible de la página (sección principal).
4. Para detener la lectura, pulsa de nuevo el botón (pasa a decir **Detener** mientras habla).

**Requisitos:**

- El navegador debe soportar la API `speechSynthesis` (Chrome, Edge, Safari, Firefox recientes suelen hacerlo).
- Debe haber sonido / altavoces o auriculares activos en el dispositivo.
- En algunos navegadores o sistemas puede hacer falta permitir el audio o tener una voz en español instalada.

**Limitaciones:**

- Se lee el texto de la página (hasta un límite razonable de caracteres), no documentos externos ni el contenido del panel de accesibilidad.
- La calidad de la voz depende del sistema operativo y del navegador.

---

## 5. Preferencias guardadas

Las opciones se almacenan localmente en tu navegador con la clave `petgo_a11y`:

- Nivel de zoom  
- Estado de alto contraste (activado / desactivado)

No se envían al servidor; son solo de este dispositivo y navegador. Si borras los datos del sitio o usas otro navegador, volverán a los valores por defecto (zoom 100 %, contraste desactivado).

---

## 6. Uso con teclado

- Puedes enfocar el botón ♿ y el panel con **Tab**.
- **Enter** o **Espacio** activan botones e interruptores.
- **Escape** cierra el panel de accesibilidad.
- Los controles tienen etiquetas accesibles (`aria-label`, `role="switch"`, etc.) para lectores de pantalla.

---

## 7. Resumen rápido

| Función            | Dónde              | Efecto                                      |
|--------------------|--------------------|---------------------------------------------|
| Zoom de texto      | A− / A+            | Cambia el tamaño del contenido (no del panel) |
| Alto contraste     | Interruptor        | Colores de mayor contraste                  |
| Lectura en voz alta| Leer página / Detener | Sintetiza el texto de la página en español |

---

## 8. Para desarrolladores

- Estilos: `css/styles.css` (sección «Accesibilidad», clases `a11y-*`, variable `--a11y-zoom`).
- Lógica: `js/app.js` → función `setupAccesibilidad()` (y helpers `applyA11y`, `setZoom`, `toggleContrast`, `toggleSpeech`).
- El panel se inyecta en el DOM al arrancar la app en cada página.
- No se modificó la lógica de autenticación ni de reservas para estas funciones.

Si se amplían las opciones de accesibilidad en el futuro (por ejemplo, reducir movimiento o modo solo teclado), este manual debería actualizarse en la misma rama o en la documentación principal.
