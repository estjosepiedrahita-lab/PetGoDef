/* PetGo — interacciones del prototipo conectadas a Supabase.
   Auth, mascotas, reservas, notificaciones y perfil viven en la base de datos (ver supabase/schema.sql). */
(function () {
  "use strict";

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var MESES_CAP = MESES.map(function (m) { return m.charAt(0).toUpperCase() + m.slice(1); });
  var LIMITE = 5;
  var BK_KEY = "petgo_booking";
  var PUBLICAS = ["", "index", "login", "registro", "mapa"];

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
  var PAGE = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");

  /* ---------- avisos ---------- */
  function toast(msg, isErr) {
    var t = h("div", "toast" + (isErr ? " err" : ""), msg);
    t.setAttribute("role", "status");
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }
  function fail(msg, err) {
    if (err && window.console) console.error(err);
    toast(msg, true);
  }
  function reveal() { document.documentElement.classList.remove("booting"); }

  /* ---------- formatos ---------- */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function money(n) { return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function fmtFecha(iso) { var p = iso.split("-"); return (+p[2]) + " de " + MESES[+p[1] - 1] + " de " + p[0]; }
  function fmtHora(t) { var p = t.split(":"), H = +p[0]; return ((H % 12) || 12) + ":" + p[1] + " " + (H >= 12 ? "PM" : "AM"); }
  function isoFecha(f) { var m = /(\d+) de (\w+) de (\d+)/.exec(f || ""); return m ? m[3] + "-" + pad(MESES.indexOf(m[2]) + 1) + "-" + pad(+m[1]) : null; }
  function hora24(hr) { var t = /(\d+):(\d+)\s*(AM|PM)/i.exec(hr || ""); return t ? pad((+t[1] % 12) + (/PM/i.test(t[3]) ? 12 : 0)) + ":" + t[2] : null; }
  function parseTs(f, hr) {
    var iso = isoFecha(f), h24 = hora24(hr) || "00:00";
    return iso ? new Date(iso + "T" + h24 + ":00").getTime() : 0;
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
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /* ---------- sesión de reserva (pasos de la reserva, solo en esta pestaña) ---------- */
  function getBooking() { try { return JSON.parse(sessionStorage.getItem(BK_KEY) || "{}"); } catch (e) { return {}; } }
  function setBooking(patch) {
    var b = getBooking();
    Object.keys(patch).forEach(function (k) { if (patch[k] === null) delete b[k]; else b[k] = patch[k]; });
    try { sessionStorage.setItem(BK_KEY, JSON.stringify(b)); } catch (e) { /* ignorar */ }
  }

  /* ================= Supabase ================= */
  var cfg = window.PETGO_SUPABASE || {};
  var sb = null;
  if (window.supabase && cfg.url && cfg.key) sb = window.supabase.createClient(cfg.url, cfg.key);

  var S = { uid: null, user: null, perfil: { nombre: "", correo: "", telefono: "", ciudad: "Bogotá" }, pets: [], reservas: [], notifs: [], pros: [] };

  function petUrl(path) { return path ? sb.storage.from("pet-photos").getPublicUrl(path).data.publicUrl : ""; }
  function mapPet(r) { return { id: r.id, nombre: r.nombre, especie: r.especie, raza: r.raza, edad: r.edad, path: r.foto_path, foto: petUrl(r.foto_path) }; }
  function mapRes(r) {
    return { id: r.id, professional_id: r.professional_id, servicio: r.servicio, profesional: (r.professionals || {}).nombre || "",
      mascota: r.pet_nombre, fecha: fmtFecha(r.fecha), hora: fmtHora(r.hora), duracion: r.duracion_min + " min", precio: money(r.precio), estado: r.estado };
  }
  function mapNotif(r) { return { id: r.id, texto: r.texto, t: Date.parse(r.created_at), leida: r.leida }; }

  async function loadAll() {
    var uid = S.uid;
    var rs = await Promise.all([
      sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
      sb.from("pets").select("*").order("created_at", { ascending: true }),
      sb.from("bookings").select("*, professionals(nombre)").order("fecha", { ascending: true }).order("hora", { ascending: true }),
      sb.from("notifications").select("*").order("created_at", { ascending: false }),
      sb.from("professionals").select("*").order("nombre", { ascending: true })
    ]);
    var err = rs.filter(function (x) { return x.error; })[0];
    if (err) throw err.error;
    var u = S.user, meta = u.user_metadata || {};
    var p = rs[0].data || {};
    S.perfil = {
      nombre: p.nombre || meta.nombre || meta.full_name || meta.name || (u.email || "").split("@")[0],
      correo: p.correo || u.email || "", telefono: p.telefono || "", ciudad: p.ciudad || "Bogotá"
    };
    S.pets = rs[1].data.map(mapPet);
    S.reservas = rs[2].data.map(mapRes);
    S.notifs = rs[3].data.map(mapNotif);
    S.pros = rs[4].data;
  }

  /* ---------- consultas sobre los datos cargados ---------- */
  function emojiFor(p) {
    var e = (p.especie || "") + " " + (p.raza || "");
    return /poodle|caniche/i.test(e) ? "🐩" : /gat/i.test(e) ? "🐈" : /perr|dog|golden|labrador/i.test(e) ? "🐕" : "🐾";
  }
  function petIcon(p, size) {
    var b = h("div", "icon-box" + (size ? " " + size : ""));
    if (p.foto) {
      b.classList.add("has-img");
      var im = h("img"); im.src = p.foto; im.alt = p.nombre;
      im.onerror = function () { b.classList.remove("has-img"); b.textContent = emojiFor(p); };
      b.appendChild(im);
    } else {
      b.textContent = emojiFor(p);
    }
    return b;
  }
  function petSub(p) { return (p.raza || p.especie || "Mascota") + (p.edad ? " · " + p.edad : ""); }
  function petByName(n) { return S.pets.filter(function (p) { return p.nombre === n; })[0]; }
  function getRes(id) { return S.reservas.filter(function (r) { return r.id === id; })[0]; }
  function getPro(id) { return S.pros.filter(function (p) { return p.id === id; })[0]; }
  function pendientes() {
    return S.reservas.filter(function (r) { return r.estado === "confirmada"; })
      .sort(function (a, b) { return parseTs(a.fecha, a.hora) - parseTs(b.fecha, b.hora); });
  }
  function canceladas() { return S.reservas.filter(function (r) { return r.estado === "cancelada"; }); }
  function servicioNombre(code) { return code === "paseo" ? "Paseo" : "Baño y peluquería"; }

  /* ---------- navegación: nombre y campana ---------- */
  function refreshNav() {
    var n = S.notifs.filter(function (x) { return !x.leida; }).length;
    $$(".bell").forEach(function (b) {
      var c = $(".count", b);
      if (n === 0) { if (c) c.remove(); }
      else { if (!c) { c = h("span", "count"); b.appendChild(c); } c.textContent = n; }
    });
    var nombre = S.perfil.nombre || "Usuario";
    $$(".js-name").forEach(function (e) { e.textContent = nombre; });
    $$(".js-initial").forEach(function (e) { e.textContent = nombre.charAt(0).toUpperCase(); });
  }

  /* ---------- fotos de assets/img (si existen) ---------- */
  function loadPhotos() {
    $$("[data-img]").forEach(function (el) {
      var src = el.getAttribute("data-img"), im = new Image();
      im.onload = function () {
        el.classList.add("has-photo");
        var ov = el.matches(".dash-svc a") ? "linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.65)), " : "";
        el.style.backgroundImage = ov + "url('" + src + "')";
      };
      im.src = src;
    });
  }

  /* ================= Inicio / login / registro ================= */
  function setupLogin() {
    var btn = $("#btn-login");
    if (!btn) return;
    var correo = $("#l-correo"), pass = $("#l-pass");
    function err(inp, msg) { var f = inp.closest(".field"); $(".msg", f).textContent = msg; f.classList.toggle("error", !!msg); }
    [correo, pass].forEach(function (i) {
      i.addEventListener("input", function () { err(i, ""); });
      i.addEventListener("keydown", function (e) { if (e.key === "Enter") btn.click(); });
    });
    btn.addEventListener("click", async function (e) {
      e.preventDefault();
      var ok = true;
      if (!/^\S+@\S+\.\S+$/.test(correo.value.trim())) { err(correo, "Ingresa un correo válido."); ok = false; }
      if (!pass.value) { err(pass, "Ingresa tu contraseña."); ok = false; }
      if (!ok) return;
      if (!sb) { fail("No se pudo conectar con el servidor."); return; }
      btn.classList.add("disabled");
      var r = await sb.auth.signInWithPassword({ email: correo.value.trim(), password: pass.value });
      btn.classList.remove("disabled");
      if (r.error) {
        err(pass, /confirm/i.test(r.error.message) ? "Debes confirmar tu correo antes de entrar." : "Correo o contraseña incorrectos.");
        return;
      }
      var next = query("next");
      location.href = next && /^[\w\-]+\.html(\?.*)?$/.test(next) ? next : "dashboard.html";
    });
  }

  function setupRegistro() {
    var reg = $("#btn-register");
    if (!reg) return;
    var rules = {
      "r-nombre": function (v) { return v.trim() ? "" : "Completa este campo."; },
      "r-correo": function (v) { return /^\S+@\S+\.\S+$/.test(v.trim()) ? "" : "Ingresa un correo válido."; },
      "r-pass": function (v) { return v.length >= 6 ? "" : "Mínimo 6 caracteres."; },
      "r-pass2": function (v) { return v && v === $("#r-pass").value ? "" : "Las contraseñas no coinciden."; }
    };
    function setErr(id, m) { var f = $("#" + id).closest(".field"); $(".msg", f).textContent = m; f.classList.toggle("error", !!m); }
    Object.keys(rules).forEach(function (id) {
      $("#" + id).addEventListener("input", function () { setErr(id, ""); });
      $("#" + id).addEventListener("keydown", function (e) { if (e.key === "Enter") reg.click(); });
    });
    reg.addEventListener("click", async function (e) {
      e.preventDefault();
      var ok = true;
      Object.keys(rules).forEach(function (id) { var m = rules[id]($("#" + id).value); setErr(id, m); if (m) ok = false; });
      if (!ok) return;
      if (!sb) { fail("No se pudo conectar con el servidor."); return; }
      reg.classList.add("disabled");
      var r = await sb.auth.signUp({
        email: $("#r-correo").value.trim(), password: $("#r-pass").value,
        options: { data: { nombre: $("#r-nombre").value.trim() } }
      });
      reg.classList.remove("disabled");
      if (r.error) {
        if (/already|registered/i.test(r.error.message)) setErr("r-correo", "Este correo ya tiene una cuenta.");
        else if (/password/i.test(r.error.message)) setErr("r-pass", "La contraseña no es válida (mínimo 6 caracteres).");
        else fail("No se pudo crear la cuenta: " + r.error.message);
        return;
      }
      // Usuario ya registrado: Supabase devuelve identities vacío en lugar de error
      if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) { setErr("r-correo", "Este correo ya tiene una cuenta."); return; }
      if (!r.data.session) { toast("Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión."); return; }
      try { sessionStorage.removeItem(BK_KEY); } catch (er) { /* ignorar */ }
      location.href = "estado-usuario-nuevo.html";
    });
  }

  /* ================= Entrar con Google (OAuth) ================= */
  function setupOAuth() {
    $$("[data-oauth]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!sb) { fail("No se pudo conectar con el servidor."); return; }
        b.disabled = true;
        var r = await sb.auth.signInWithOAuth({
          provider: b.dataset.oauth,
          options: { redirectTo: new URL("dashboard.html", location.href).href }
        });
        if (r.error) { b.disabled = false; fail("No se pudo iniciar con " + b.dataset.oauth + ": " + r.error.message, r.error); }
      });
    });
  }

  /* ================= Catálogo: resultados y detalle ================= */
  function renderResultados() {
    var box = $("#results");
    if (!box) return;
    var svc = /paseos/.test(PAGE) ? "paseo" : "bano";
    var det = svc === "paseo" ? "detalle-paseos.html" : "detalle-banos.html";
    var list = S.pros.filter(function (p) { return p.servicio === svc; });
    var cnt = $("#res-count");
    if (cnt) cnt.textContent = list.length + (list.length === 1 ? " profesional disponible" : " profesionales disponibles") + " en Bogotá";
    box.innerHTML = "";
    if (!list.length) {
      var e = h("div", "empty"), b = h("a", "btn", "Volver a servicios"); b.href = "servicios.html";
      add(e, h("div", "big", "🔍"), h("div", "tt", "Sin resultados"), h("p", "tx", "Lo sentimos, no encontramos servicios disponibles."), b);
      box.appendChild(e);
      return;
    }
    list.forEach(function (p) {
      var a = h("a", "pro-card"); a.href = det + "?pro=" + encodeURIComponent(p.id);
      var ph = h("div", "photo", "🐕"); ph.setAttribute("data-img", "assets/img/pro-" + p.id + ".jpg");
      var body = h("div", "body");
      var r1 = add(h("div", "r1"), h("span", "nm", p.nombre), h("span", "badge ok", "Disponible"));
      var st = add(h("span", "stars"), h("span", "s", "★"), h("span", "v", String(p.rating)));
      var r2 = add(h("div", "r2"), st, h("span", "meta", "(" + p.resenas + " reseñas)"), h("span", "meta", "📍 " + p.zona));
      var pr = add(h("div", "pr"), h("b", null, money(p.precio)), h("span", null, "· " + p.duracion_min + " min"));
      var r3 = add(h("div", "r3"), pr, h("span", "btn sm", "Ver detalle"));
      add(body, r1, r2, h("p", "ds", p.descripcion), r3);
      add(a, ph, body);
      box.appendChild(a);
    });
  }

  function renderDetalle() {
    var root = $(".detail[data-default]");
    if (!root) return;
    var p = getPro(query("pro")) || getPro(root.dataset.default);
    if (!p) return;
    var vals = {
      nombre: p.nombre, rating: String(p.rating), meta: "(" + p.resenas + " reseñas) · Bogotá",
      precio: money(p.precio), duracion: p.duracion_min + " min", zona: p.zona, detalle: p.detalle || p.descripcion, horario: p.horario || ""
    };
    $$("[data-d]").forEach(function (el) { el.textContent = vals[el.dataset.d]; });
    document.title = p.nombre + " · PetGo";
    $("#d-photo").setAttribute("data-img", "assets/img/pro-" + p.id + ".jpg");
    var a = $("[data-reservar]");
    a.dataset.pro = p.id; a.dataset.profesional = p.nombre; a.dataset.duracion = vals.duracion;
    a.dataset.precio = vals.precio; a.dataset.servicio = servicioNombre(p.servicio);
    a.dataset.volver = PAGE + ".html?pro=" + encodeURIComponent(p.id);
  }

  /* ================= Reserva: inicio y mascota ================= */
  function setupReservar() {
    $$("[data-reservar]").forEach(function (a) {
      a.addEventListener("click", function () {
        setBooking({
          servicio: a.dataset.servicio, profesional: a.dataset.profesional, profesionalId: a.dataset.pro,
          duracion: a.dataset.duracion, precio: a.dataset.precio, volver: a.dataset.volver,
          reprogramar: null, fecha: null, hora: null, mascota: null
        });
      });
    });
    var backDetail = $("#back-detail");
    if (backDetail && getBooking().volver) backDetail.setAttribute("href", getBooking().volver);
  }

  function setupElegirMascota() {
    var petOpts = $("#pet-opts");
    if (!petOpts) return false;
    if (pendientes().length >= LIMITE && !getBooking().reprogramar) { location.replace("estado-limite-de-reservas.html"); return true; }
    var next = $("#pet-next");
    petOpts.innerHTML = "";
    if (!S.pets.length) {
      var emp = h("div", "empty"), ab = h("a", "btn", "Agregar mascota"); ab.href = "mis-mascotas.html";
      add(emp, h("div", "big", "🐾"), h("div", "tt", "Aún no tienes mascotas"), h("p", "tx", "Agrega una mascota para poder reservar."), ab);
      petOpts.appendChild(emp);
      next.classList.add("disabled");
      return false;
    }
    var pre = getBooking().mascota;
    if (!petByName(pre)) pre = S.pets[0].nombre;
    setBooking({ mascota: pre, mascotaId: (petByName(pre) || {}).id });
    S.pets.forEach(function (p) {
      var b = h("button", "pet-opt" + (p.nombre === pre ? " sel" : ""));
      b.type = "button"; b.setAttribute("aria-pressed", p.nombre === pre ? "true" : "false");
      var dt = h("span", "dt"); add(dt, h("b", null, p.nombre), h("span", null, petSub(p)));
      add(b, petIcon(p), dt, h("span", "ck", "✓"));
      b.addEventListener("click", function () {
        $$(".pet-opt", petOpts).forEach(function (x) { x.classList.remove("sel"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("sel"); b.setAttribute("aria-pressed", "true");
        setBooking({ mascota: p.nombre, mascotaId: p.id });
      });
      petOpts.appendChild(b);
    });
    return false;
  }

  /* ================= Calendario y horarios ================= */
  function setupCalendario() {
    var calRoot = $("#calendar");
    if (!calRoot) return;
    var bk0 = getBooking();
    var back = $("#back-fecha");
    if (back && bk0.reprogramar) back.setAttribute("href", "detalle-de-reserva.html?id=" + encodeURIComponent(bk0.reprogramar));
    var proId = bk0.profesionalId || "happy-walk";

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var months = [0, 1, 2].map(function (i) { var d = new Date(today.getFullYear(), today.getMonth() + i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    var idx = 0, selected = null;
    var preSel = $(".slot.sel[data-hora]");
    var hora = preSel ? preSel.dataset.hora : null;
    var title = $(".mt", calRoot), prev = $("#cal-prev"), nextBtn = $("#cal-next");
    var days = $(".cal-days", calRoot), selTxt = $("#cal-sel-text");
    var slots = $$(".slot[data-hora]");
    var reqId = 0;

    function fechaStr(s) { return s.d + " de " + MESES[s.m] + " de " + s.y; }
    function fechaIso(s) { return s.y + "-" + pad(s.m + 1) + "-" + pad(s.d); }

    async function refreshSlots() {
      var my = ++reqId;
      slots.forEach(function (s) { if (s.classList.contains("dyn")) { s.classList.remove("off", "dyn"); s.disabled = false; } });
      if (!selected) return;
      var r = await sb.rpc("slots_ocupados", { p_professional: proId, p_fecha: fechaIso(selected) });
      if (my !== reqId || r.error) return;
      var ocupadas = (r.data || []).map(function (t) { return String(t).slice(0, 5); });
      // si estamos reprogramando, la propia reserva no cuenta como ocupada
      var propia = bk0.reprogramar && getRes(bk0.reprogramar);
      slots.forEach(function (s) {
        var h24 = hora24(s.dataset.hora);
        var esPropia = propia && propia.professional_id === proId && isoFecha(propia.fecha) === fechaIso(selected) && hora24(propia.hora) === h24;
        if (ocupadas.indexOf(h24) !== -1 && !esPropia) {
          s.classList.add("off", "dyn"); s.classList.remove("sel"); s.disabled = true;
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
  function setupConfirmar() {
    var bk = getBooking();
    $$("[data-bk]").forEach(function (el) { var v = bk[el.dataset.bk]; if (v) el.textContent = v; });

    var confirmBtn = $("#confirm-res");
    if (confirmBtn) {
      confirmBtn.addEventListener("click", async function (e) {
        e.preventDefault();
        var b = getBooking(), rid = b.reprogramar;
        var v = {};
        $$("[data-bk]").forEach(function (el) { v[el.dataset.bk] = el.textContent.trim(); });
        var fecha = isoFecha(v.fecha), hr = hora24(v.hora);
        if (!fecha || !hr) { toast("Elige primero la fecha y la hora.", true); return; }
        confirmBtn.classList.add("disabled");
        var res, r;
        if (rid && (r = getRes(rid))) {
          res = await sb.from("bookings").update({ fecha: fecha, hora: hr }).eq("id", rid).select("id").single();
        } else {
          var pro = getPro(b.profesionalId || "happy-walk");
          if (!pro) { confirmBtn.classList.remove("disabled"); fail("Elige primero un profesional."); return; }
          var pet = petByName(v.mascota);
          res = await sb.from("bookings").insert({
            professional_id: pro.id, pet_id: pet ? pet.id : null, pet_nombre: v.mascota,
            fecha: fecha, hora: hr, servicio: v.servicio, precio: pro.precio, duracion_min: pro.duracion_min
          }).select("id").single();
        }
        confirmBtn.classList.remove("disabled");
        if (res.error) {
          var m = (res.error.message || "") + " " + (res.error.code || "");
          if (/23505|duplicate|bookings_slot_unico/i.test(m)) { location.href = "estado-horario-ocupado.html"; return; }
          if (/LIMITE_RESERVAS/.test(m)) { location.href = "estado-limite-de-reservas.html"; return; }
          if (/FECHA_PASADA/.test(m)) { fail("Esa fecha ya pasó. Elige otra."); return; }
          fail("No se pudo guardar la reserva. Intenta de nuevo.", res.error);
          return;
        }
        setBooking({ ultima: res.data.id, reprogramar: null });
        location.href = "confirmacion.html";
      });
    }
    var seeRes = $("#see-res");
    if (seeRes && bk.ultima) seeRes.setAttribute("href", "detalle-de-reserva.html?id=" + encodeURIComponent(bk.ultima));
  }

  /* ================= Filtros y pestañas ================= */
  function setupUiBasica() {
    $$(".chip-f").forEach(function (c) { c.addEventListener("click", function () { c.classList.toggle("on"); }); });
    var tabs = $$(".tab[data-tab]");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (x) { x.classList.toggle("on", x === t); });
        $$("[data-panel]").forEach(function (p) { p.hidden = p.dataset.panel !== t.dataset.tab; });
      });
    });
  }

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
  function renderMisReservas() {
    var panelProx = $("#res-proximas");
    if (!panelProx) return;
    var prox = pendientes(), hist = canceladas();
    $("#tab-prox").textContent = "Próximas (" + prox.length + ")";
    $("#tab-hist").textContent = "Historial (" + hist.length + ")";
    $("#quota-n").textContent = prox.length + "/" + LIMITE;
    $("#quota-bar").style.width = Math.min(100, prox.length / LIMITE * 100) + "%";
    panelProx.innerHTML = "";
    if (!prox.length) {
      var e1 = h("div", "empty"), b1 = h("a", "btn", "Reservar servicio"); b1.href = "servicios.html";
      add(e1, h("div", "big", "📅"), h("div", "tt", "Sin reservas"), h("p", "tx", "Todavía no tienes reservas."), b1);
      panelProx.appendChild(e1);
    }
    prox.forEach(function (r) { panelProx.appendChild(resCard(r)); });
    var panelHist = $("#res-historial");
    panelHist.innerHTML = "";
    if (!hist.length) panelHist.appendChild(h("p", "hist-note", "Aún no tienes reservas en tu historial."));
    hist.forEach(function (r) { panelHist.appendChild(resCard(r)); });
  }

  /* ================= Detalle de reserva / cancelar ================= */
  function setupDetalleReserva() {
    var resBadge = $("#res-badge");
    if (!resBadge) return;
    var rid = query("id");
    var res = (rid && getRes(rid)) || pendientes()[0] || S.reservas[0];
    if (!res) {
      var col = $(".col");
      if (col) {
        col.innerHTML = "";
        var e2 = h("div", "empty"), b2 = h("a", "btn", "Ver mis reservas"); b2.href = "mis-reservas.html";
        add(e2, h("div", "big", "📅"), h("div", "tt", "Sin reservas"), h("p", "tx", "No encontramos esta reserva."), b2);
        col.appendChild(e2);
      }
      return;
    }
    $$("[data-res]").forEach(function (el) { if (res[el.dataset.res]) el.textContent = res[el.dataset.res]; });
    var cancelled = res.estado === "cancelada" || resBadge.dataset.force === "cancelada";
    resBadge.className = "badge " + (cancelled ? "cancel" : "next");
    resBadge.textContent = cancelled ? "Cancelada" : "Próxima";
    var actions = $("#res-actions");
    if (cancelled && actions) actions.hidden = true;
    var q = "?id=" + encodeURIComponent(res.id);
    var bc = $("#btn-cancel"); if (bc) bc.setAttribute("href", "modal-cancelar-reserva.html" + q);
    var mb = $("#m-back"); if (mb) mb.setAttribute("href", "detalle-de-reserva.html" + q);

    var dc = $("#do-cancel");
    if (dc) dc.addEventListener("click", async function (e) {
      e.preventDefault();
      if (res.estado === "confirmada") {
        dc.classList.add("disabled");
        var r = await sb.from("bookings").update({ estado: "cancelada" }).eq("id", res.id);
        dc.classList.remove("disabled");
        if (r.error) { fail("No se pudo cancelar la reserva. Intenta de nuevo.", r.error); return; }
      }
      location.href = "estado-reserva-cancelada.html" + q;
    });

    var rp = $("#btn-reprog");
    if (rp) rp.addEventListener("click", function () {
      setBooking({
        servicio: res.servicio, profesional: res.profesional, profesionalId: res.professional_id, mascota: res.mascota,
        duracion: res.duracion, precio: res.precio, reprogramar: res.id, fecha: null, hora: null
      });
    });
  }

  /* ================= Notificaciones ================= */
  function setupNotificaciones() {
    var notifList = $("#notif-list");
    if (!notifList) return;
    function render() {
      notifList.innerHTML = "";
      if (!S.notifs.length) notifList.appendChild(h("p", "hist-note", "No tienes notificaciones."));
      S.notifs.forEach(function (n) {
        var b = h("button", "notif" + (n.leida ? "" : " unread"));
        b.type = "button";
        var tx = h("span", "tx"); add(tx, h("span", "t1", n.texto), h("span", "t2", rel(n.t)));
        var dot = h("img", "dot"); dot.src = "assets/punto-sin-leer.svg"; dot.alt = ""; dot.width = 10; dot.height = 10;
        add(b, h("span", "icon-box s", "🔔"), tx, dot);
        b.addEventListener("click", async function () {
          if (n.leida) return;
          var r = await sb.from("notifications").update({ leida: true }).eq("id", n.id);
          if (r.error) { fail("No se pudo actualizar la notificación.", r.error); return; }
          n.leida = true; render(); refreshNav();
        });
        notifList.appendChild(b);
      });
      var c = S.notifs.filter(function (x) { return !x.leida; }).length;
      var s = $("#unread-count");
      if (s) s.textContent = c === 0 ? "Todas leídas" : c + " sin leer";
    }
    render();
    var markAll = $("#mark-all");
    if (markAll) markAll.addEventListener("click", async function () {
      var r = await sb.from("notifications").update({ leida: true }).eq("leida", false);
      if (r.error) { fail("No se pudieron marcar como leídas.", r.error); return; }
      S.notifs.forEach(function (n) { n.leida = true; });
      render(); refreshNav();
    });
  }

  /* ================= Mis mascotas ================= */
  function setupMascotas() {
    var petForm = $("#pet-form");
    if (!petForm) return;
    var list = $("#pet-list");
    var fNombre = $("#f-nombre"), fNombreWrap = fNombre.closest(".field");
    var fEsp = $("#f-especie"), fRaza = $("#f-raza"), fEdad = $("#f-edad");
    var fFoto = $("#f-foto"), fotoTx = $("#foto-tx"), fotoBlob = null, saving = false;

    function renderPets() {
      list.innerHTML = "";
      if (!S.pets.length) list.appendChild(h("p", "hist-note", "Aún no tienes mascotas. Agrega la primera con el formulario."));
      S.pets.forEach(function (p) {
        var row = h("div", "pet-row"), card = h("div", "card"), dt = h("div", "dt");
        add(dt, h("b", null, p.nombre), h("span", null, petSub(p)));
        add(card, petIcon(p), dt);
        var del = h("button", "btn danger sm js-del", "Eliminar"); del.type = "button";
        del.addEventListener("click", async function () {
          if (!confirm("¿Eliminar a " + p.nombre + "?")) return;
          del.disabled = true;
          var r = await sb.from("pets").delete().eq("id", p.id);
          if (r.error) { del.disabled = false; fail("No se pudo eliminar la mascota.", r.error); return; }
          if (p.path) sb.storage.from("pet-photos").remove([p.path]);
          S.pets = S.pets.filter(function (x) { return x.id !== p.id; });
          renderPets();
        });
        add(row, card, del);
        list.appendChild(row);
      });
    }
    renderPets();

    fNombre.addEventListener("input", function () { fNombreWrap.classList.remove("error"); });

    // La foto se reduce (máx. 640 px) antes de subirla.
    fFoto.addEventListener("change", function () {
      var f = fFoto.files && fFoto.files[0];
      fotoBlob = null;
      if (!f) { fotoTx.textContent = "Subir foto"; return; }
      fotoTx.textContent = f.name;
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 640 / Math.max(im.width, im.height));
        var cv = document.createElement("canvas");
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { fotoBlob = b; }, "image/jpeg", 0.85);
        URL.revokeObjectURL(url);
      };
      im.onerror = function () { fotoTx.textContent = "Subir foto"; toast("No se pudo leer esa imagen.", true); };
      im.src = url;
    });

    $("#btn-add").addEventListener("click", function (e) {
      e.preventDefault();
      fNombre.scrollIntoView({ behavior: "smooth", block: "center" });
      fNombre.focus({ preventScroll: true });
    });

    async function savePet() {
      if (saving) return;
      var nombre = fNombre.value.trim();
      if (!nombre) { fNombreWrap.classList.add("error"); fNombre.focus(); return; }
      saving = true;
      var btn = $("#save-pet"); btn.classList.add("disabled");
      try {
        var path = null;
        if (fotoBlob) {
          path = S.uid + "/" + uuid() + ".jpg";
          var up = await sb.storage.from("pet-photos").upload(path, fotoBlob, { contentType: "image/jpeg" });
          if (up.error) { fail("No se pudo subir la foto.", up.error); path = null; }
        }
        var esp = fEsp.value.trim() || "Perro";
        var r = await sb.from("pets").insert({ nombre: nombre, especie: esp, raza: fRaza.value.trim() || esp, edad: fEdad.value.trim() || null, foto_path: path }).select("*").single();
        if (r.error) { fail("No se pudo guardar la mascota.", r.error); return; }
        S.pets.push(mapPet(r.data));
        fNombre.value = ""; fEsp.value = ""; fRaza.value = ""; fEdad.value = ""; fFoto.value = ""; fotoBlob = null; fotoTx.textContent = "Subir foto";
        renderPets();
      } finally { saving = false; btn.classList.remove("disabled"); }
    }
    petForm.addEventListener("submit", function (e) { e.preventDefault(); savePet(); });
    $("#save-pet").addEventListener("click", function (e) { e.preventDefault(); savePet(); });
  }

  /* ================= Dashboard ================= */
  function setupDashboard() {
    var dashNext = $("#dash-next");
    if (!dashNext) return;
    var r0 = pendientes()[0], aviso = $("#dash-aviso");
    if (!r0) {
      aviso.innerHTML = ""; dashNext.innerHTML = "";
      var e3 = h("div", "empty"), b3 = h("a", "btn", "Reservar servicio"); b3.href = "servicios.html";
      add(e3, h("div", "big", "📅"), h("div", "tt", "Sin reservas"), h("p", "tx", "Todavía no tienes reservas."), b3);
      dashNext.appendChild(e3);
    } else {
      var href = "detalle-de-reserva.html?id=" + encodeURIComponent(r0.id);
      var dias = Math.round((new Date(isoFecha(r0.fecha) + "T00:00:00") - new Date().setHours(0, 0, 0, 0)) / 864e5);
      $(".t1", aviso).textContent = dias === 1 ? "Tu reserva de mañana está próxima." : dias === 0 ? "Tu reserva es hoy." : "Tu próxima reserva es el " + r0.fecha + ".";
      $(".t2", aviso).textContent = "🐕 " + r0.mascota + " · 📅 " + r0.fecha + " — " + r0.hora;
      $("a", aviso).href = href;
      $(".svc", dashNext).textContent = r0.servicio;
      var vs = $$(".data .v", dashNext);
      vs[0].textContent = r0.mascota; vs[1].textContent = r0.fecha; vs[2].textContent = r0.hora;
      $(".foot span", dashNext).textContent = r0.profesional;
      $(".go", dashNext).href = href;
    }
    var mini = $("#dash-pets");
    mini.innerHTML = "";
    if (!S.pets.length) { var ap = h("a", "btn soft", "+ Agregar mascota"); ap.href = "mis-mascotas.html"; mini.appendChild(ap); }
    S.pets.forEach(function (p) {
      var a = h("a"); a.href = "mis-mascotas.html";
      add(a, petIcon(p, "xs"), h("span", "n", p.nombre), h("span", "r", p.raza || p.especie));
      mini.appendChild(a);
    });
  }

  /* ================= Perfil ================= */
  function setupPerfil() {
    var editRow = $("#edit-open");
    if (!editRow) return;
    var card = $("#edit-card"), flash = $("#flash");
    var K = ["nombre", "correo", "telefono", "ciudad"];
    var P = { nombre: $("#p-nombre"), correo: $("#p-correo"), telefono: $("#p-tel"), ciudad: $("#p-ciudad") };
    var V = { nombre: $("#v-nombre"), correo: $("#v-correo"), telefono: $("#v-tel"), ciudad: $("#v-ciudad") };
    function paint() {
      K.forEach(function (k) { V[k].textContent = S.perfil[k] || "—"; P[k].value = S.perfil[k] || ""; });
      $("#v-inicial").textContent = (S.perfil.nombre || "A").charAt(0).toUpperCase();
    }
    paint();
    P.correo.readOnly = true;   // el correo es el de la cuenta; cambiarlo requiere verificación
    function open() { card.classList.add("open"); editRow.hidden = true; flash.classList.remove("show"); }
    function close() { card.classList.remove("open"); editRow.hidden = false; }
    editRow.addEventListener("click", open);
    $("#edit-cancel").addEventListener("click", function () { paint(); close(); });
    $("#edit-save").addEventListener("click", async function () {
      var patch = { nombre: P.nombre.value.trim() || S.perfil.nombre, telefono: P.telefono.value.trim(), ciudad: P.ciudad.value.trim() || S.perfil.ciudad };
      var r = await sb.from("profiles").update(patch).eq("id", S.uid);
      if (r.error) { fail("No se pudieron guardar los cambios.", r.error); return; }
      S.perfil.nombre = patch.nombre; S.perfil.telefono = patch.telefono; S.perfil.ciudad = patch.ciudad;
      paint(); refreshNav(); close(); flash.classList.add("show");
    });
    var out = $("#btn-logout");
    if (out) out.addEventListener("click", async function (e) {
      e.preventDefault();
      try { sessionStorage.removeItem(BK_KEY); } catch (er) { /* ignorar */ }
      await sb.auth.signOut();
      location.href = "index.html";
    });
  }

  /* ================= Accesibilidad (zoom, contraste, lectura en voz alta) ================= */
  var A11Y_KEY = "petgo_a11y";
  var A11Y_ZOOMS = [0.9, 1, 1.15, 1.3, 1.5];
  var a11yState = { zoom: 1, contrast: false };
  var a11ySpeaking = false;

  function loadA11y() {
    try {
      var raw = localStorage.getItem(A11Y_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (typeof o.zoom === "number") a11yState.zoom = o.zoom;
        if (typeof o.contrast === "boolean") a11yState.contrast = o.contrast;
      }
    } catch (e) { /* ignorar */ }
  }
  function saveA11y() {
    try { localStorage.setItem(A11Y_KEY, JSON.stringify(a11yState)); } catch (e) { /* ignorar */ }
  }
  function applyA11y() {
    document.documentElement.style.setProperty("--a11y-zoom", String(a11yState.zoom));
    document.documentElement.classList.toggle("a11y-contrast", !!a11yState.contrast);
    // zoom activo solo cuando no es 1 (para no interferir con layout base)
    document.body.classList.toggle("a11y-zoom-active", a11yState.zoom !== 1);
    var levelEl = document.getElementById("a11y-zoom-level");
    if (levelEl) levelEl.textContent = Math.round(a11yState.zoom * 100) + "%";
    var sw = document.getElementById("a11y-contrast-sw");
    if (sw) sw.classList.toggle("on", !!a11yState.contrast);
  }
  function setZoom(delta) {
    var i = A11Y_ZOOMS.indexOf(a11yState.zoom);
    if (i < 0) i = 1;
    i = Math.max(0, Math.min(A11Y_ZOOMS.length - 1, i + delta));
    a11yState.zoom = A11Y_ZOOMS[i];
    saveA11y();
    applyA11y();
  }
  function toggleContrast() {
    a11yState.contrast = !a11yState.contrast;
    saveA11y();
    applyA11y();
  }
  function getPageText() {
    var main = document.querySelector("main") || document.body;
    var clone = main.cloneNode(true);
    // quitar scripts, estilos y el propio panel
    var remove = clone.querySelectorAll("script, style, #a11y-root, noscript");
    for (var i = 0; i < remove.length; i++) remove[i].remove();
    var text = (clone.innerText || clone.textContent || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 8000); // límite razonable
  }
  function stopSpeech() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    a11ySpeaking = false;
    var btn = document.getElementById("a11y-speak");
    if (btn) btn.textContent = "Leer página";
  }
  function toggleSpeech() {
    if (!window.speechSynthesis) {
      toast("Tu navegador no soporta lectura en voz alta.", true);
      return;
    }
    if (a11ySpeaking) {
      stopSpeech();
      return;
    }
    var text = getPageText();
    if (!text) {
      toast("No hay texto para leer.", true);
      return;
    }
    stopSpeech();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 1;
    u.onend = function () { a11ySpeaking = false; var b = document.getElementById("a11y-speak"); if (b) b.textContent = "Leer página"; };
    u.onerror = function () { a11ySpeaking = false; var b = document.getElementById("a11y-speak"); if (b) b.textContent = "Leer página"; };
    a11ySpeaking = true;
    var btn = document.getElementById("a11y-speak");
    if (btn) btn.textContent = "Detener";
    speechSynthesis.speak(u);
  }
  function setupAccesibilidad() {
    if (document.getElementById("a11y-root")) return;
    loadA11y();
    applyA11y();

    var root = h("div");
    root.id = "a11y-root";
    root.setAttribute("aria-label", "Herramientas de accesibilidad");

    var toggle = h("button");
    toggle.id = "a11y-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "a11y-panel");
    toggle.title = "Accesibilidad";
    toggle.innerHTML = "♿";
    toggle.addEventListener("click", function () {
      var panel = document.getElementById("a11y-panel");
      var open = panel.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    var panel = h("div");
    panel.id = "a11y-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Opciones de accesibilidad");

    var title = h("h3", null, "Accesibilidad");
    panel.appendChild(title);

    // Zoom
    var rowZ = h("div", "a11y-row");
    rowZ.appendChild(h("span", "a11y-label", "Tamaño del texto"));
    var ctrZ = h("div", "a11y-controls");
    var btnMinus = h("button", "a11y-btn", "A−");
    btnMinus.type = "button";
    btnMinus.title = "Reducir texto";
    btnMinus.setAttribute("aria-label", "Reducir tamaño del texto");
    btnMinus.addEventListener("click", function () { setZoom(-1); });
    var level = h("span", "a11y-level");
    level.id = "a11y-zoom-level";
    level.textContent = Math.round(a11yState.zoom * 100) + "%";
    var btnPlus = h("button", "a11y-btn", "A+");
    btnPlus.type = "button";
    btnPlus.title = "Aumentar texto";
    btnPlus.setAttribute("aria-label", "Aumentar tamaño del texto");
    btnPlus.addEventListener("click", function () { setZoom(1); });
    add(ctrZ, btnMinus, level, btnPlus);
    rowZ.appendChild(ctrZ);
    panel.appendChild(rowZ);
    var hint = h("div", "a11y-hint", "Solo afecta al contenido, no a este panel");
    panel.appendChild(hint);

    // Contraste
    var rowC = h("div", "a11y-row");
    rowC.appendChild(h("span", "a11y-label", "Alto contraste"));
    var sw = h("button", "a11y-switch");
    sw.id = "a11y-contrast-sw";
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", a11yState.contrast ? "true" : "false");
    sw.setAttribute("aria-label", "Activar alto contraste");
    if (a11yState.contrast) sw.classList.add("on");
    sw.addEventListener("click", function () {
      toggleContrast();
      sw.setAttribute("aria-checked", a11yState.contrast ? "true" : "false");
    });
    rowC.appendChild(sw);
    panel.appendChild(rowC);

    // Lectura en voz alta
    var rowS = h("div", "a11y-row");
    rowS.appendChild(h("span", "a11y-label", "Lectura en voz alta"));
    var btnSpeak = h("button", "a11y-btn", "Leer página");
    btnSpeak.id = "a11y-speak";
    btnSpeak.type = "button";
    btnSpeak.setAttribute("aria-label", "Leer el contenido de la página en voz alta");
    btnSpeak.addEventListener("click", toggleSpeech);
    rowS.appendChild(btnSpeak);
    panel.appendChild(rowS);

    root.appendChild(panel);
    root.appendChild(toggle);
    document.body.appendChild(root);

    // Cerrar panel al hacer clic fuera
    document.addEventListener("click", function (e) {
      if (!root.contains(e.target)) {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
    // Escape cierra el panel
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("open")) {
        panel.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ================= Menú hamburguesa (móvil) ================= */
  function setupNavMenu() {
    var bar = document.querySelector(".navbar-in");
    var links = document.querySelector(".nav-links");
    if (!bar || !links || document.getElementById("nav-toggle")) return;

    var btn = document.createElement("button");
    btn.id = "nav-toggle";
    btn.className = "nav-toggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Abrir menú de navegación");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", "nav-links-menu");
    btn.innerHTML = "<span></span><span></span><span></span>";
    links.id = links.id || "nav-links-menu";

    // Insertar el botón antes de las acciones (o al final del navbar-in)
    var actions = bar.querySelector(".nav-actions") || bar.querySelector(".nav-public");
    if (actions) bar.insertBefore(btn, actions);
    else bar.appendChild(btn);

    var overlay = document.createElement("div");
    overlay.className = "nav-overlay";
    overlay.id = "nav-overlay";
    document.body.appendChild(overlay);

    function close() {
      links.classList.remove("open");
      overlay.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Abrir menú de navegación");
      document.body.style.overflow = "";
    }
    function open() {
      links.classList.add("open");
      overlay.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      btn.setAttribute("aria-label", "Cerrar menú de navegación");
      document.body.style.overflow = "hidden";
    }
    function toggle() {
      if (links.classList.contains("open")) close();
      else open();
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggle();
    });
    overlay.addEventListener("click", close);
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) close();
    });
  }

  /* ================= Arranque ================= */
  async function boot() {
    setupAccesibilidad();
    setupNavMenu();
    try {
      var publica = PUBLICAS.indexOf(PAGE) !== -1;
      if (!sb) {
        if (!publica) { toast("No se pudo cargar Supabase. Revisa tu conexión.", true); }
        loadPhotos(); setupLogin(); setupRegistro(); setupOAuth();
        return;
      }
      var sess = (await sb.auth.getSession()).data.session;

      // Páginas públicas
      if (publica) {
        // Con sesión abierta, el login y el registro llevan directo al panel
        if (sess && (PAGE === "login" || PAGE === "registro") && !query("stay")) { location.replace("dashboard.html"); return; }
        loadPhotos(); setupLogin(); setupRegistro(); setupOAuth();
        return;
      }
      // Páginas privadas
      if (!sess) {
        location.replace("login.html?next=" + encodeURIComponent(PAGE + ".html" + location.search));
        return;
      }
      S.uid = sess.user.id; S.user = sess.user;
      await loadAll();

      setupReservar();
      renderResultados();
      renderDetalle();
      if (setupElegirMascota()) return;
      setupCalendario();
      setupConfirmar();
      setupUiBasica();
      renderMisReservas();
      setupDetalleReserva();
      setupNotificaciones();
      setupMascotas();
      setupDashboard();
      setupPerfil();
      refreshNav();
      loadPhotos();
    } catch (e) {
      fail("No se pudieron cargar tus datos. Recarga la página.", e);
    } finally {
      reveal();
    }
  }
  boot();
})();
