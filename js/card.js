(function () {
  "use strict";

  var results = document.querySelector("[data-card-results]");
  var count = document.querySelector("[data-card-count]");

  if (!results || !count || !results.dataset.json || !results.dataset.detail) return;
  var detailUrl = new URL(results.dataset.detail, document.baseURI).href;
  var countLabel = results.dataset.countLabel || "profesionales disponibles en Bogotá";

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

  function createCard(profesional) {
    var card = element("a", "pro-card");
    card.href = detailUrl;
    card.setAttribute("aria-label", "Ver detalle de " + profesional.nombre);

    var photo = element("div", "photo", profesional.emoji || "🐕");
    if (profesional.imagen) photo.setAttribute("data-img", profesional.imagen);
    loadPhoto(photo, profesional.imagen);

    var body = element("div", "body");
    var heading = element("div", "r1");
    heading.appendChild(element("span", "nm", profesional.nombre));
    var estado = profesional.estado.trim().toLocaleLowerCase("es");
    var disponible = estado === "disponible";
    var textoEstado = disponible ? "Disponible" : estado === "no disponible" ? "No Disponible" : profesional.estado;
    heading.appendChild(element("span", "badge " + (disponible ? "ok" : "unavailable"), textoEstado));

    var information = element("div", "r2");
    var stars = element("span", "stars");
    stars.appendChild(element("span", "s", "★"));
    stars.appendChild(element("span", "v", profesional.calificacion));
    information.appendChild(stars);
    information.appendChild(element("span", "meta", "(" + profesional.resenas + " reseñas)"));
    information.appendChild(element("span", "meta", "📍 " + profesional.ubicacion));

    var footer = element("div", "r3");
    var price = element("div", "pr");
    price.appendChild(element("b", null, profesional.precio));
    price.appendChild(element("span", null, "· " + profesional.duracion));
    footer.appendChild(price);
    footer.appendChild(element("span", "btn sm", "Ver detalle"));

    body.appendChild(heading);
    body.appendChild(information);
    body.appendChild(element("p", "ds", profesional.descripcion));
    body.appendChild(footer);
    card.appendChild(photo);
    card.appendChild(body);
    return card;
  }

  function showError(error) {
    console.error("No se pudieron cargar los profesionales.", error);
    var messageText = "No fue posible cargar los profesionales.";
    if (window.location.protocol === "file:") {
      messageText += " Abre el proyecto con Live Server para permitir la carga del JSON.";
    } else {
      messageText += " Verifica el archivo de datos configurado y consulta la consola para más detalles.";
    }
    var message = element("p", "sub", messageText);
    message.setAttribute("role", "alert");
    results.replaceChildren(message);
    count.textContent = "No se pudieron cargar los profesionales";
  }

  var dataUrl = new URL(results.dataset.json, document.currentScript.src);
  fetch(dataUrl)
    .then(function (response) {
      if (!response.ok) throw new Error("Error HTTP " + response.status);
      return response.json();
    })
    .then(function (paseadores) {
      if (!Array.isArray(paseadores)) throw new TypeError("El archivo debe contener una lista de profesionales.");

      paseadores.forEach(function (profesional) {
        if (!profesional || !profesional.nombre || !profesional.estado || !profesional.calificacion ||
            !Number.isFinite(profesional.resenas) || !profesional.ubicacion || !profesional.descripcion ||
            !profesional.precio || !profesional.duracion) {
          throw new TypeError("Hay un profesional con datos incompletos.");
        }
      });

      results.replaceChildren.apply(results, paseadores.map(createCard));
      count.textContent = paseadores.length + " " + countLabel;
    })
    .catch(showError);
})();
