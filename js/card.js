(function () {
  "use strict";

  var results = document.getElementById("paseadores-results");
  var count = document.getElementById("paseadores-count");

  if (!results || !count) return;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function loadPhoto(photo, src) {
    if (!src) return;

    var image = new Image();
    image.onload = function () {
      photo.classList.add("has-photo");
      photo.style.backgroundImage = "url('" + src.replace(/'/g, "%27") + "')";
    };
    image.src = src;
  }

  function createCard(paseador) {
    var card = element("a", "pro-card");
    card.href = "detalle-paseos.html";
    card.setAttribute("aria-label", "Ver detalle de " + paseador.nombre);

    var photo = element("div", "photo", paseador.emoji || "🐕");
    if (paseador.imagen) photo.setAttribute("data-img", paseador.imagen);
    loadPhoto(photo, paseador.imagen);

    var body = element("div", "body");
    var heading = element("div", "r1");
    heading.appendChild(element("span", "nm", paseador.nombre));
    heading.appendChild(element("span", "badge ok", paseador.estado));

    var information = element("div", "r2");
    var stars = element("span", "stars");
    stars.appendChild(element("span", "s", "★"));
    stars.appendChild(element("span", "v", paseador.calificacion));
    information.appendChild(stars);
    information.appendChild(element("span", "meta", "(" + paseador.resenas + " reseñas)"));
    information.appendChild(element("span", "meta", "📍 " + paseador.ubicacion));

    var footer = element("div", "r3");
    var price = element("div", "pr");
    price.appendChild(element("b", null, paseador.precio));
    price.appendChild(element("span", null, "· " + paseador.duracion));
    footer.appendChild(price);
    footer.appendChild(element("span", "btn sm", "Ver detalle"));

    body.appendChild(heading);
    body.appendChild(information);
    body.appendChild(element("p", "ds", paseador.descripcion));
    body.appendChild(footer);
    card.appendChild(photo);
    card.appendChild(body);
    return card;
  }

  function showError(error) {
    console.error("No se pudieron cargar los paseadores.", error);
    var messageText = "No fue posible cargar los paseadores.";
    if (window.location.protocol === "file:") {
      messageText += " Abre el proyecto con Live Server para permitir la carga del JSON.";
    } else {
      messageText += " Verifica la ruta data/paseadores.json y consulta la consola para más detalles.";
    }
    var message = element("p", "sub", messageText);
    message.setAttribute("role", "alert");
    results.replaceChildren(message);
    count.textContent = "No se pudieron cargar los profesionales";
  }

  var dataUrl = new URL("../data/paseadores.json", document.currentScript.src);
  fetch(dataUrl)
    .then(function (response) {
      if (!response.ok) throw new Error("Error HTTP " + response.status);
      return response.json();
    })
    .then(function (paseadores) {
      if (!Array.isArray(paseadores)) throw new TypeError("El archivo debe contener una lista de paseadores.");

      paseadores.forEach(function (paseador) {
        if (!paseador || !paseador.nombre || !paseador.estado || !paseador.calificacion ||
            !Number.isFinite(paseador.resenas) || !paseador.ubicacion || !paseador.descripcion ||
            !paseador.precio || !paseador.duracion) {
          throw new TypeError("Hay un paseador con datos incompletos.");
        }
      });

      results.replaceChildren.apply(results, paseadores.map(createCard));
      count.textContent = paseadores.length + " profesionales disponibles en Bogotá";
    })
    .catch(showError);
})();
