/* PetGo — interacciones y datos del prototipo (sin dependencias).
   Los datos (mascotas, reservas, notificaciones, perfil) se guardan en localStorage del navegador,
   así que los cambios persisten al navegar, recargar o cerrar la pestaña. */
(function () {
  "use strict";

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var MESES_CAP = MESES.map(function (m) { return m.charAt(0).toUpperCase() + m.slice(1); });
  var LIMITE = 5;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function query(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /* ================= Datos persistentes ================= */
  var DB_KEY = "petgo_db_v1";
  var BK_KEY = "petgo_booking";
  var db;

  function seed() {
    var now = Date.now(), H = 3600e3;
    return {
      pets: [
        { id: "p1", nombre: "Max", especie: "Perro", raza: "Golden Retriever", edad: "3 años", emoji: "🐕", foto: "" },
        { id: "p2", nombre: "Luna", especie: "Perro", raza: "Poodle", edad: "2 años", emoji: "🐩", foto: "" }
      ],
      reservas: [
        { id: "r1", servicio: "Baño y peluquería", profesional: "PetGo Grooming", mascota: "Max", fecha: "28 de octubre de 2026", hora: "3:00 PM", duracion: "90 min", precio: "$35.000", estado: "confirmada" },
        { id: "r2", servicio: "Paseo", profesional: "Happy Walk", mascota: "Luna", fecha: "22 de octubre de 2026", hora: "10:00 AM", duracion: "30 min", precio: "$18.000", estado: "confirmada" }
      ],
      notifs: [
        { id: "n1", texto: "Tu paseo con Happy Walk es mañana.", t: now - 2 * H, leida: false },
        { id: "n2", texto: "Tu reserva ha sido confirmada.", t: now - 24 * H, leida: false },
        { id: "n3", texto: "Tu reserva fue cancelada.", t: now - 72 * H, leida: true }
      ],
      perfil: { nombre: "Aiko", correo: "demo@petgo.com", tel: "+57 300 123 4567", ciudad: "Bogotá" }
    };
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(DB_KEY));
      if (d && d.pets && d.reservas && d.notifs && d.perfil) return d;
    } catch (e) { /* sin almacenamiento */ }
    var s = seed();
    try { localStorage.setItem(DB_KEY, JSON.stringify(s)); } catch (e) { /* ignorar */ }
    return s;
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (e) { alert("No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado."); return false; }
  }
  db = load();

  function getBooking() { try { return JSON.parse(sessionStorage.getItem(BK_KEY) || "{}"); } catch (e) { return {}; } }
  function setBooking(patch) {
    var b = getBooking();
    Object.keys(patch).forEach(function (k) { if (patch[k] === null) delete b[k]; else b[k] = patch[k]; });
    try { sessionStorage.setItem(BK_KEY, JSON.stringify(b)); } catch (e) { /* ignorar */ }
  }

  function uid(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function parseTs(f, hr) {
    var m = /(\d+) de (\w+) de (\d+)/.exec(f || "");
    if (!m) return 0;
    var t = /(\d+):(\d+)\s*(AM|PM)/i.exec(hr || "");
    var H = t ? (+t[1] % 12) + (/PM/i.test(t[3]) ? 12 : 0) : 0;
    return new Date(+m[3], MESES.indexOf(m[2]), +m[1], H, t ? +t[2] : 0).getTime();
  }
  function rel(t) {
    var s = (Date.now() - t) / 1000;
    if (s < 60) return "Justo ahora";
    var m = Math.floor(s / 60);
    if (m < 60) return "Hace " + m + (m === 1 ? " minuto" : " minutos");
    var hr = Math.floor(m / 60);
    if (hr < 24) return "Hace " + hr + (hr === 1 ? " hora" : " horas");
    var d = Math.floor(hr / 24);
    return "Hace " + d + (d === 1 ? " día" : " días");
  }
  function emojiFor(p) {
    if (p.emoji) return p.emoji;
    var e = (p.especie || "") + " " + (p.raza || "");
    return /gat/i.test(e) ? "🐈" : /perr|dog/i.test(e) ? "🐕" : "🐾";
  }
  function petIcon(p, size) {
    var b = h("div", "icon-box" + (size ? " " + size : ""));
    if (p.foto) {
      b.classList.add("has-img");
      var im = h("img"); im.src = p.foto; im.alt = p.nombre;
      b.appendChild(im);
    } else {
      b.textContent = emojiFor(p);
    }
    return b;
  }
  function petSub(p) { return (p.raza || p.especie || "Mascota") + (p.edad ? " · " + p.edad : ""); }
  function petByName(n) { return db.pets.filter(function (p) { return p.nombre === n; })[0]; }
  function getRes(id) { return db.reservas.filter(function (r) { return r.id === id; })[0]; }
  function pendientes() {
    return db.reservas.filter(function (r) { return r.estado === "confirmada"; })
      .sort(function (a, b) { return parseTs(a.fecha, a.hora) - parseTs(b.fecha, b.hora); });
  }
  function canceladas() {
    return db.reservas.filter(function (r) { return r.estado === "cancelada"; });
  }
  function notify(texto) { db.notifs.unshift({ id: uid("n"), texto: texto, t: Date.now(), leida: false }); }
  function taken(pro, fecha, hora, excludeId) {
    return db.reservas.some(function (r) {
      return r.estado === "confirmada" && r.profesional === pro && r.fecha === fecha && r.hora === hora && r.id !== excludeId;
    });
  }

  /* ================= Todas las páginas: barra de navegación ================= */
  function refreshNav() {
    var n = db.notifs.filter(function (x) { return !x.leida; }).length;
    $$(".bell").forEach(function (b) {
      var c = $(".count", b);
      if (n === 0) { if (c) c.remove(); }
      else { if (!c) { c = h("span", "count"); b.appendChild(c); } c.textContent = n; }
    });
    var nombre = db.perfil.nombre || "Aiko";
    $$(".js-name").forEach(function (e) { e.textContent = nombre; });
    $$(".js-initial").forEach(function (e) { e.textContent = nombre.charAt(0).toUpperCase(); });
  }

  /* ================= Fotos de assets/img (si existen) ================= */
  $$("[data-img]").forEach(function (el) {
    var src = el.getAttribute("data-img"), im = new Image();
    im.onload = function () {
      el.classList.add("has-photo");
      var ov = el.matches(".dash-svc a") ? "linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.65)), " : "";
      el.style.backgroundImage = ov + "url('" + src + "')";
    };
    im.src = src;
  });

  /* ================= Detalle del profesional → inicia la reserva ================= */
  $$("[data-reservar]").forEach(function (a) {
    a.addEventListener("click", function () {
      setBooking({
        servicio: a.dataset.servicio, profesional: a.dataset.profesional,
        duracion: a.dataset.duracion, precio: a.dataset.precio, volver: a.dataset.volver,
        reprogramar: null, fecha: null, hora: null, mascota: null
      });
    });
  });
  var backDetail = $("#back-detail");
  if (backDetail && getBooking().volver) backDetail.setAttribute("href", getBooking().volver);

  /* ================= Elegir mascota ================= */
  var petOpts = $("#pet-opts");
  if (petOpts) {
    if (pendientes().length >= LIMITE && !getBooking().reprogramar) location.replace("estado-limite-de-reservas.html");
    var next = $("#pet-next");
    petOpts.innerHTML = "";
    if (!db.pets.length) {
      var emp = h("div", "empty");
      add(emp, h("div", "big", "🐾"), h("div", "tt", "Aún no tienes mascotas"), h("p", "tx", "Agrega una mascota para poder reservar."));
      var ab = h("a", "btn", "Agregar mascota"); ab.href = "mis-mascotas.html";
      add(emp, ab); petOpts.appendChild(emp);
      next.classList.add("disabled");
      next.addEventListener("click", function (e) { e.preventDefault(); });
    } else {
      var pre = getBooking().mascota;
      if (!petByName(pre)) pre = db.pets[0].nombre;
      setBooking({ mascota: pre });
      db.pets.forEach(function (p) {
        var b = h("button", "pet-opt" + (p.nombre === pre ? " sel" : ""));
        b.type = "button"; b.setAttribute("aria-pressed", p.nombre === pre ? "true" : "false");
        var dt = h("span", "dt"); add(dt, h("b", null, p.nombre), h("span", null, petSub(p)));
        add(b, petIcon(p), dt, h("span", "ck", "✓"));
        b.addEventListener("click", function () {
          $$(".pet-opt", petOpts).forEach(function (x) { x.classList.remove("sel"); x.setAttribute("aria-pressed", "false"); });
          b.classList.add("sel"); b.setAttribute("aria-pressed", "true");
          setBooking({ mascota: p.nombre });
        });
        petOpts.appendChild(b);
      });
    }
  }

  /* ================= Calendario y horarios ================= */
  var calRoot = $("#calendar");
  if (calRoot) {
    var bk0 = getBooking();
    var back = $("#back-fecha");
    if (back && bk0.reprogramar) back.setAttribute("href", "detalle-de-reserva.html?id=" + encodeURIComponent(bk0.reprogramar));

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var months = [0, 1, 2].map(function (i) { var d = new Date(today.getFullYear(), today.getMonth() + i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    var idx = 0, selected = null, hora = ($(".slot.sel[data-hora]") || {}).dataset ? $(".slot.sel[data-hora]").dataset.hora : null;
    var title = $(".mt", calRoot), prev = $("#cal-prev"), nextBtn = $("#cal-next");
    var days = $(".cal-days", calRoot), selTxt = $("#cal-sel-text");
    var slots = $$(".slot[data-hora]");

    function fechaStr(s) { return s.d + " de " + MESES[s.m] + " de " + s.y; }
    function refreshSlots() {
      slots.forEach(function (s) {
        if (s.classList.contains("dyn")) { s.classList.remove("off", "dyn"); s.disabled = false; }
      });
      if (!selected) return;
      slots.forEach(function (s) {
        if (taken(bk0.profesional || "Happy Walk", fechaStr(selected), s.dataset.hora, bk0.reprogramar)) {
          s.classList.add("off", "dyn", "tk"); s.classList.remove("sel"); s.disabled = true;
          if (hora === s.dataset.hora) hora = null;
        }
      });
    }
    function render() {
      var cur = months[idx];
      title.textContent = MESES_CAP[cur.m] + " " + cur.y;
      prev.disabled = idx === 0;
      nextBtn.disabled = idx === months.length - 1;
      days.innerHTML = "";
      var first = new Date(cur.y, cur.m, 1).getDay();
      var total = new Date(cur.y, cur.m + 1, 0).getDate();
      var i, d;
      for (i = 0; i < first; i++) days.appendChild(document.createElement("div"));
      for (d = 1; d <= total; d++) {
        var disabled = new Date(cur.y, cur.m, d) < today;
        var el = document.createElement(disabled ? "div" : "button");
        el.textContent = d;
        if (disabled) {
          el.className = "off";
        } else {
          el.type = "button";
          (function (day) {
            el.addEventListener("click", function () {
              selected = { y: cur.y, m: cur.m, d: day };
              selTxt.classList.remove("warn");
              selTxt.textContent = fechaStr(selected);
              refreshSlots();
              render();
            });
          })(d);
          if (selected && selected.y === cur.y && selected.m === cur.m && selected.d === d) el.className = "sel";
        }
        days.appendChild(el);
      }
    }
    prev.addEventListener("click", function () { if (idx > 0) { idx--; render(); } });
    nextBtn.addEventListener("click", function () { if (idx < months.length - 1) { idx++; render(); } });
    render();

    slots.forEach(function (s) {
      s.addEventListener("click", function () {
        if (s.disabled) return;
        slots.forEach(function (x) { x.classList.remove("sel"); });
        s.classList.add("sel");
        hora = s.dataset.hora;
        selTxt.classList.remove("warn");
      });
    });

    $("#cal-ok").addEventListener("click", function (e) {
      if (!selected || !hora) {
        e.preventDefault();
        selTxt.textContent = !selected ? "Selecciona una fecha para continuar" : "Selecciona un horario disponible";
        selTxt.classList.add("warn");
        return;
      }
      setBooking({ fecha: fechaStr(selected), hora: hora });
    });
  }

  /* ================= Resumen / confirmar reserva ================= */
  var bk = getBooking();
  $$("[data-bk]").forEach(function (el) { var v = bk[el.dataset.bk]; if (v) el.textContent = v; });

  var confirmBtn = $("#confirm-res");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var v = {};
      $$("[data-bk]").forEach(function (el) { v[el.dataset.bk] = el.textContent.trim(); });
      var b = getBooking(), rid = b.reprogramar;
      if (taken(v.profesional, v.fecha, v.hora, rid)) { location.href = "estado-horario-ocupado.html"; return; }
      var r;
      if (rid && (r = getRes(rid))) {
        r.fecha = v.fecha; r.hora = v.hora;
        notify("Tu reserva fue reprogramada para el " + v.fecha + " a las " + v.hora + ".");
      } else {
        if (pendientes().length >= LIMITE) { location.href = "estado-limite-de-reservas.html"; return; }
        r = { id: uid("r"), servicio: v.servicio, profesional: v.profesional, mascota: v.mascota, fecha: v.fecha, hora: v.hora, duracion: v.duracion, precio: v.precio, estado: "confirmada" };
        db.reservas.push(r);
        notify("Tu reserva ha sido confirmada.");
      }
      if (!save()) return;
      setBooking({ ultima: r.id, reprogramar: null });
      location.href = "confirmacion.html";
    });
  }
  var seeRes = $("#see-res");
  if (seeRes && bk.ultima) seeRes.setAttribute("href", "detalle-de-reserva.html?id=" + encodeURIComponent(bk.ultima));

  /* ================= Filtros y pestañas ================= */
  $$(".chip-f").forEach(function (c) { c.addEventListener("click", function () { c.classList.toggle("on"); }); });
  var tabs = $$(".tab[data-tab]");
  tabs.forEach(function (t) {
    t.addEventListener("click", function () {
      tabs.forEach(function (x) { x.classList.toggle("on", x === t); });
      $$("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== t.dataset.tab; });
    });
  });

  /* ================= Mis reservas ================= */
  function resCard(r) {
    var card = h("div", "res-card");
    var hd = h("div", "hd"), tx = h("div", "tx");
    add(tx, h("b", null, r.servicio), h("span", null, r.profesional));
    var ok = r.estado === "confirmada";
    add(hd, h("div", "icon-box xs", "🐾"), tx, h("span", "badge " + (ok ? "ok" : "cancel"), ok ? "Confirmada" : "Cancelada"));
    var dat = h("div", "dat");
    [["Mascota", r.mascota], ["Fecha", r.fecha], ["Hora", r.hora]].forEach(function (p) {
      add(dat, add(h("div"), h("span", "k", p[0]), h("span", "v", p[1])));
    });
    var ft = h("div", "ft"), a = h("a", "btn soft", "Ver detalles");
    a.href = "detalle-de-reserva.html?id=" + encodeURIComponent(r.id);
    add(ft, h("b", null, r.precio), a);
    return add(card, hd, dat, ft);
  }
  var panelProx = $("#res-proximas");
  if (panelProx) {
    var prox = pendientes(), hist = canceladas();
    $("#tab-prox").textContent = "Próximas (" + prox.length + ")";
    $("#tab-hist").textContent = "Historial (" + hist.length + ")";
    $("#quota-n").textContent = prox.length + "/" + LIMITE;
    $("#quota-bar").style.width = Math.min(100, prox.length / LIMITE * 100) + "%";
    if (!prox.length) {
      var e1 = h("div", "empty");
      var b1 = h("a", "btn", "Reservar servicio"); b1.href = "servicios.html";
      add(e1, h("div", "big", "📅"), h("div", "tt", "Sin reservas"), h("p", "tx", "Todavía no tienes reservas."), b1);
      panelProx.appendChild(e1);
    }
    prox.forEach(function (r) { panelProx.appendChild(resCard(r)); });
    var panelHist = $("#res-historial");
    if (!hist.length) panelHist.appendChild(h("p", "hist-note", "Aún no tienes reservas en tu historial."));
    hist.forEach(function (r) { panelHist.appendChild(resCard(r)); });
  }

  /* ================= Detalle de reserva / cancelar ================= */
  var resBadge = $("#res-badge");
  if (resBadge) {
    var rid = query("id");
    var res = (rid && getRes(rid)) || pendientes()[0] || db.reservas[0];
    var fill = function () {
      $$("[data-res]").forEach(function (el) { if (res && res[el.dataset.res]) el.textContent = res[el.dataset.res]; });
    };
    if (res) {
      fill();
      var cancelled = res.estado === "cancelada" || resBadge.dataset.force === "cancelada";
      resBadge.className = "badge " + (cancelled ? "cancel" : "next");
      resBadge.textContent = cancelled ? "Cancelada" : "Próxima";
      var actions = $("#res-actions");
      if (cancelled && actions) actions.hidden = true;
      var q = "?id=" + encodeURIComponent(res.id);
      var bc = $("#btn-cancel"); if (bc) bc.setAttribute("href", "modal-cancelar-reserva.html" + q);
      var mb = $("#m-back"); if (mb) mb.setAttribute("href", "detalle-de-reserva.html" + q);
      var dc = $("#do-cancel");
      if (dc) dc.addEventListener("click", function (e) {
        e.preventDefault();
        if (res.estado === "confirmada") { res.estado = "cancelada"; notify("Tu reserva fue cancelada."); if (!save()) return; }
        location.href = "estado-reserva-cancelada.html" + q;
      });
      var rp = $("#btn-reprog");
      if (rp) rp.addEventListener("click", function () {
        setBooking({ servicio: res.servicio, profesional: res.profesional, mascota: res.mascota, duracion: res.duracion, precio: res.precio, reprogramar: res.id, fecha: null, hora: null });
      });
    } else {
      var col = $(".col");
      if (col) { col.innerHTML = ""; var e2 = h("div", "empty"), b2 = h("a", "btn", "Ver mis reservas"); b2.href = "mis-reservas.html"; add(e2, h("div", "big", "📅"), h("div", "tt", "Sin reservas"), h("p", "tx", "No encontramos esta reserva."), b2); col.appendChild(e2); }
    }
  }

  /* ================= Notificaciones ================= */
  var notifList = $("#notif-list");
  function renderNotifs() {
    if (!notifList) return;
    notifList.innerHTML = "";
    if (!db.notifs.length) notifList.appendChild(h("p", "hist-note", "No tienes notificaciones."));
    db.notifs.forEach(function (n) {
      var b = h("button", "notif" + (n.leida ? "" : " unread"));
      b.type = "button";
      var tx = h("span", "tx"); add(tx, h("span", "t1", n.texto), h("span", "t2", rel(n.t)));
      var dot = h("img", "dot"); dot.src = "assets/punto-sin-leer.svg"; dot.alt = ""; dot.width = 10; dot.height = 10;
      add(b, h("span", "icon-box s", "🔔"), tx, dot);
      b.addEventListener("click", function () { if (!n.leida) { n.leida = true; save(); renderNotifs(); refreshNav(); } });
      notifList.appendChild(b);
    });
    var c = db.notifs.filter(function (x) { return !x.leida; }).length;
    var s = $("#unread-count");
    if (s) s.textContent = c === 0 ? "Todas leídas" : c + " sin leer";
  }
  renderNotifs();
  var markAll = $("#mark-all");
  if (markAll) markAll.addEventListener("click", function () {
    db.notifs.forEach(function (n) { n.leida = true; });
    save(); renderNotifs(); refreshNav();
  });

  /* ================= Mis mascotas ================= */
  var petForm = $("#pet-form");
  if (petForm) {
    var list = $("#pet-list");
    var fNombre = $("#f-nombre"), fNombreWrap = fNombre.closest(".field");
    var fEsp = $("#f-especie"), fRaza = $("#f-raza"), fEdad = $("#f-edad");
    var fFoto = $("#f-foto"), fotoTx = $("#foto-tx"), fotoData = "";

    var renderPets = function () {
      list.innerHTML = "";
      if (!db.pets.length) list.appendChild(h("p", "hist-note", "Aún no tienes mascotas. Agrega la primera con el formulario."));
      db.pets.forEach(function (p) {
        var row = h("div", "pet-row"), card = h("div", "card"), dt = h("div", "dt");
        add(dt, h("b", null, p.nombre), h("span", null, petSub(p)));
        add(card, petIcon(p), dt);
        var del = h("button", "btn danger sm js-del", "Eliminar"); del.type = "button";
        del.addEventListener("click", function () {
          if (!confirm("¿Eliminar a " + p.nombre + "?")) return;
          db.pets = db.pets.filter(function (x) { return x.id !== p.id; });
          if (save()) renderPets();
        });
        add(row, card, del);
        list.appendChild(row);
      });
    };
    renderPets();

    fNombre.addEventListener("input", function () { fNombreWrap.classList.remove("error"); });

    // La foto se reduce (máx. 320 px) para que quepa en el almacenamiento del navegador.
    fFoto.addEventListener("change", function () {
      var f = fFoto.files && fFoto.files[0];
      fotoData = "";
      if (!f) { fotoTx.textContent = "Subir foto"; return; }
      fotoTx.textContent = f.name;
      var rd = new FileReader();
      rd.onload = function () {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, 320 / Math.max(im.width, im.height));
          var cv = document.createElement("canvas");
          cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
          cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
          fotoData = cv.toDataURL("image/jpeg", 0.8);
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(f);
    });

    $("#btn-add").addEventListener("click", function (e) {
      e.preventDefault();
      fNombre.scrollIntoView({ behavior: "smooth", block: "center" });
      fNombre.focus({ preventScroll: true });
    });

    var savePet = function () {
      var nombre = fNombre.value.trim();
      if (!nombre) { fNombreWrap.classList.add("error"); fNombre.focus(); return; }
      var esp = fEsp.value.trim() || "Perro";
      db.pets.push({ id: uid("p"), nombre: nombre, especie: esp, raza: fRaza.value.trim() || esp, edad: fEdad.value.trim(), emoji: "", foto: fotoData });
      if (!save()) { db.pets.pop(); return; }
      fNombre.value = ""; fEsp.value = ""; fRaza.value = ""; fEdad.value = ""; fFoto.value = ""; fotoData = ""; fotoTx.textContent = "Subir foto";
      renderPets();
    };
    petForm.addEventListener("submit", function (e) { e.preventDefault(); savePet(); });
    $("#save-pet").addEventListener("click", function (e) { e.preventDefault(); savePet(); });
  }

  /* ================= Dashboard ================= */
  var dashNext = $("#dash-next");
  if (dashNext) {
    var pend = pendientes(), r0 = pend[0], aviso = $("#dash-aviso");
    if (!r0) {
      aviso.innerHTML = ""; dashNext.innerHTML = "";
      var e3 = h("div", "empty"), b3 = h("a", "btn", "Reservar servicio"); b3.href = "servicios.html";
      add(e3, h("div", "big", "📅"), h("div", "tt", "Sin reservas"), h("p", "tx", "Todavía no tienes reservas."), b3);
      dashNext.appendChild(e3);
    } else {
      var href = "detalle-de-reserva.html?id=" + encodeURIComponent(r0.id);
      var dias = Math.round((new Date(parseTs(r0.fecha, "12:00 AM")) - new Date().setHours(0, 0, 0, 0)) / 864e5);
      var t1 = $(".t1", aviso), t2 = $(".t2", aviso);
      t1.textContent = dias === 1 ? "Tu reserva de mañana está próxima." : dias === 0 ? "Tu reserva es hoy." : "Tu próxima reserva es el " + r0.fecha + ".";
      t2.textContent = "🐕 " + r0.mascota + " · 📅 " + r0.fecha + " — " + r0.hora;
      $("a", aviso).href = href;
      $(".svc", dashNext).textContent = r0.servicio;
      var vs = $$(".data .v", dashNext);
      vs[0].textContent = r0.mascota; vs[1].textContent = r0.fecha; vs[2].textContent = r0.hora;
      $(".foot span", dashNext).textContent = r0.profesional;
      $(".go", dashNext).href = href;
    }
    var mini = $("#dash-pets");
    mini.innerHTML = "";
    if (!db.pets.length) {
      var ap = h("a", "btn soft", "+ Agregar mascota"); ap.href = "mis-mascotas.html"; mini.appendChild(ap);
    }
    db.pets.forEach(function (p) {
      var a = h("a"); a.href = "mis-mascotas.html";
      add(a, petIcon(p, "xs"), h("span", "n", p.nombre), h("span", "r", p.raza || p.especie));
      mini.appendChild(a);
    });
  }

  /* ================= Registro ================= */
  var reg = $("#btn-register");
  if (reg) {
    var rules = {
      "r-nombre": function (v) { return v.trim() ? "" : "Completa este campo."; },
      "r-correo": function (v) { return /^\S+@\S+\.\S+$/.test(v.trim()) ? "" : "Ingresa un correo válido."; },
      "r-pass": function (v) { return v.length >= 6 ? "" : "Mínimo 6 caracteres."; },
      "r-pass2": function (v) { return v === $("#r-pass").value && v ? "" : "Las contraseñas no coinciden."; }
    };
    Object.keys(rules).forEach(function (id) {
      $("#" + id).addEventListener("input", function () { $("#" + id).closest(".field").classList.remove("error"); });
    });
    reg.addEventListener("click", function (e) {
      e.preventDefault();
      var ok = true;
      Object.keys(rules).forEach(function (id) {
        var inp = $("#" + id), f = inp.closest(".field"), m = rules[id](inp.value);
        $(".msg", f).textContent = m;
        f.classList.toggle("error", !!m);
        if (m) ok = false;
      });
      if (!ok) return;
      // Cuenta nueva: empieza sin mascotas ni reservas.
      db = { pets: [], reservas: [], notifs: [], perfil: { nombre: $("#r-nombre").value.trim(), correo: $("#r-correo").value.trim(), tel: "", ciudad: "Bogotá" } };
      db.notifs.push({ id: uid("n"), texto: "¡Bienvenido a PetGo! Reserva tu primer servicio.", t: Date.now(), leida: false });
      if (!save()) return;
      try { sessionStorage.removeItem(BK_KEY); } catch (er) { /* ignorar */ }
      location.href = "estado-usuario-nuevo.html";
    });
  }

  /* ================= Perfil ================= */
  var editRow = $("#edit-open");
  if (editRow) {
    var card2 = $("#edit-card"), flash = $("#flash");
    var P = { nombre: $("#p-nombre"), correo: $("#p-correo"), tel: $("#p-tel"), ciudad: $("#p-ciudad") };
    var V = { nombre: $("#v-nombre"), correo: $("#v-correo"), tel: $("#v-tel"), ciudad: $("#v-ciudad") };
    var paint = function () {
      Object.keys(P).forEach(function (k) { V[k].textContent = db.perfil[k] || "—"; P[k].value = db.perfil[k] || ""; });
      $("#v-inicial").textContent = (db.perfil.nombre || "A").charAt(0).toUpperCase();
    };
    paint();
    var open = function () { card2.classList.add("open"); editRow.hidden = true; flash.classList.remove("show"); };
    var close = function () { card2.classList.remove("open"); editRow.hidden = false; };
    editRow.addEventListener("click", open);
    $("#edit-cancel").addEventListener("click", function () { paint(); close(); });
    $("#edit-save").addEventListener("click", function () {
      Object.keys(P).forEach(function (k) {
        var v = P[k].value.trim();
        if (v || k === "tel") db.perfil[k] = v;
      });
      if (!save()) return;
      paint(); refreshNav(); close(); flash.classList.add("show");
    });
  }

  /* ================= Restablecer datos de la demo (mapa.html) ================= */
  $$("[data-reset]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!confirm("¿Volver a los datos de ejemplo? Se perderán tus cambios.")) return;
      try { localStorage.removeItem(DB_KEY); sessionStorage.removeItem(BK_KEY); } catch (e) { /* ignorar */ }
      db = load(); refreshNav(); alert("Datos restablecidos.");
    });
  });

  refreshNav();
})();
