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
  var DEMO = query("demo") === "1" || (function(){try {return sessionStorage.getItem("petgo_preview") === "1";}catch(e){return false;}})();
  if (query("demo") === "1") try { sessionStorage.setItem("petgo_preview", "1"); } catch(e) {}

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

  function readLocal(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function loadDemo() {
    S.uid="demo";
    S.perfil={nombre:"Usuario de demostración",correo:"demo@petgo.local",telefono:"",ciudad:"Bogotá"};
    S.pets=[{id:"p-max",nombre:"Max",especie:"Perro",raza:"Golden Retriever",edad:"3",foto:""},{id:"p-luna",nombre:"Luna",especie:"Perro",raza:"Poodle",edad:"2",foto:""}];
    S.reservas=[];S.notifs=[];
    S.pros=[];
  }
  /* ================= Capa de datos =================
     Si window.PETGO_API_URL está definido, los datos pasan por la API propia (backend/).
     Si está vacío, el sitio habla directo con Supabase (modo de respaldo). Ambos devuelven {data, error}
     y los errores usan los mismos códigos: horario_ocupado, limite_reservas, fecha_pasada, ... */
  var API_URL = String(window.PETGO_API_URL || "").replace(/\/+$/, "");

  function sbError(res) {
    if (!res || !res.error) return res;
    var m = (res.error.message || "") + " " + (res.error.code || "");
    var code = /23505|duplicate|bookings_slot_unico/i.test(m) ? "horario_ocupado"
      : /LIMITE_RESERVAS/.test(m) ? "limite_reservas"
      : /FECHA_PASADA/.test(m) ? "fecha_pasada"
      : /FUERA_DE_HORARIO/.test(m) ? "fuera_de_horario"
      : /DIRECCION_REQUERIDA/.test(m) ? "direccion_requerida"
      : /RESERVA_CANCELADA/.test(m) ? "reserva_cancelada" : "error";
    return { data: null, error: { code: code, message: res.error.message, raw: res.error } };
  }
  async function sbq(promise) { return sbError(await promise); }

  var viaSb = {
    me: {
      get: function () { return sbq(sb.from("profiles").select("*").eq("id", S.uid).maybeSingle()); },
      update: function (patch) { return sbq(sb.from("profiles").update(patch).eq("id", S.uid)); }
    },
    pets: {
      list: function () { return sbq(sb.from("pets").select("*").order("created_at", { ascending: true })); },
      create: function (o) { return sbq(sb.from("pets").insert(o).select("*").single()); },
      update: function (id, patch) { return sbq(sb.from("pets").update(patch).eq("id", id).select("*").single()); },
      remove: function (id) { return sbq(sb.from("pets").delete().eq("id", id)); }
    },
    biz: {
      get: function () { return sbq(sb.from("businesses").select("*").maybeSingle()); },
      create: function (o) { return sbq(sb.from("businesses").insert(o).select("*").single()); },
      update: function (id, patch) { return sbq(sb.from("businesses").update(patch).eq("id", id).select("*").single()); }
    },
    workers: {
      list: function () { return sbq(sb.from("workers").select("*").order("created_at", { ascending: true })); },
      create: function (o, bizId) { return sbq(sb.from("workers").insert(Object.assign({ business_id: bizId }, o)).select("*").single()); },
      update: function (id, patch) { return sbq(sb.from("workers").update(patch).eq("id", id).select("*").single()); },
      remove: function (id) { return sbq(sb.from("workers").delete().eq("id", id)); }
    },
    offers: {
      list: function () { return sbq(sb.from("professionals").select("*").not("business_id", "is", null).order("servicio", { ascending: true })); },
      create: function (o, bizId) { return sbq(sb.from("professionals").insert(Object.assign({ business_id: bizId }, o)).select("*").single()); },
      update: function (id, patch) { return sbq(sb.from("professionals").update(patch).eq("id", id).select("*").single()); },
      remove: async function (id) {
        var r = await sbq(sb.from("professionals").delete().eq("id", id));
        if (r.error && /23503|foreign key/i.test((r.error.message || "") + (r.error.raw && r.error.raw.code || ""))) r.error.code = "oferta_con_reservas";
        return r;
      }
    },
    citas: { list: function () { return sbq(sb.rpc("provider_bookings")); } },
    team: function (businessId) { return sbq(sb.from("workers").select("id,nombre,funcion,descripcion,foto_path").eq("business_id", businessId).order("created_at", { ascending: true })); },
    bookings: {
      list: function () { return sbq(sb.from("bookings").select("*, professionals(nombre)").order("fecha", { ascending: true }).order("hora", { ascending: true })); },
      create: function (o) {
        var pro = getPro(o.professional_id) || {};
        return sbq(sb.from("bookings").insert(Object.assign({ servicio: servicioNombre(pro.servicio), precio: pro.precio, duracion_min: pro.duracion_min }, o)).select("id").single());
      },
      update: function (id, patch) { return sbq(sb.from("bookings").update(patch).eq("id", id).select("id").single()); },
      cancel: function (id) { return sbq(sb.from("bookings").update({ estado: "cancelada" }).eq("id", id)); }
    },
    notifs: {
      list: function () { return sbq(sb.from("notifications").select("*").order("created_at", { ascending: false })); },
      read: function (id) { return sbq(sb.from("notifications").update({ leida: true }).eq("id", id)); },
      readAll: function () { return sbq(sb.from("notifications").update({ leida: true }).eq("leida", false)); }
    },
    pros: { list: function () { return sbq(sb.from("professionals").select("*").order("nombre", { ascending: true })); } },
    slots: function (pro, fecha) { return sbq(sb.rpc("slots_ocupados", { p_professional: pro, p_fecha: fecha })); }
  };

  async function call(method, path, body) {
    var sess = (await sb.auth.getSession()).data.session;
    var res;
    try {
      res = await fetch(API_URL + path, {
        method: method,
        headers: { Authorization: "Bearer " + (sess ? sess.access_token : ""), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      return { data: null, error: { code: "sin_conexion", message: "No se pudo conectar con el servidor.", raw: e } };
    }
    var text = await res.text(), json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { /* respuesta no JSON */ }
    if (!res.ok) {
      var er = (json && json.error) || {};
      return { data: null, error: { code: er.code || "http_" + res.status, message: er.message || "Error " + res.status, status: res.status } };
    }
    return { data: json, error: null };
  }
  var viaApi = {
    me: { get: function () { return call("GET", "/api/me"); }, update: function (patch) { return call("PATCH", "/api/me", patch); } },
    pets: {
      list: function () { return call("GET", "/api/pets"); },
      create: function (o) { return call("POST", "/api/pets", o); },
      update: function (id, patch) { return call("PATCH", "/api/pets/" + encodeURIComponent(id), patch); },
      remove: function (id) { return call("DELETE", "/api/pets/" + encodeURIComponent(id)); }
    },
    biz: {
      get: function () { return call("GET", "/api/business"); },
      create: function (o) { return call("POST", "/api/business", o); },
      update: function (id, patch) { return call("PATCH", "/api/business", patch); }
    },
    workers: {
      list: function () { return call("GET", "/api/business/workers"); },
      create: function (o) { return call("POST", "/api/business/workers", o); },
      update: function (id, patch) { return call("PATCH", "/api/business/workers/" + encodeURIComponent(id), patch); },
      remove: function (id) { return call("DELETE", "/api/business/workers/" + encodeURIComponent(id)); }
    },
    offers: {
      list: function () { return call("GET", "/api/business/offers"); },
      create: function (o) { return call("POST", "/api/business/offers", o); },
      update: function (id, patch) { return call("PATCH", "/api/business/offers/" + encodeURIComponent(id), patch); },
      remove: function (id) { return call("DELETE", "/api/business/offers/" + encodeURIComponent(id)); }
    },
    citas: { list: function () { return call("GET", "/api/business/bookings"); } },
    team: function (businessId, proId) { return call("GET", "/api/professionals/" + encodeURIComponent(proId) + "/workers"); },
    bookings: {
      list: function () { return call("GET", "/api/bookings"); },
      create: function (o) { return call("POST", "/api/bookings", o); },
      update: function (id, patch) { return call("PATCH", "/api/bookings/" + encodeURIComponent(id), patch); },
      cancel: function (id) { return call("POST", "/api/bookings/" + encodeURIComponent(id) + "/cancel"); }
    },
    notifs: {
      list: function () { return call("GET", "/api/notifications"); },
      read: function (id) { return call("PATCH", "/api/notifications/" + encodeURIComponent(id), { leida: true }); },
      readAll: function () { return call("POST", "/api/notifications/read-all"); }
    },
    pros: { list: function () { return call("GET", "/api/professionals"); } },
    slots: function (pro, fecha) { return call("GET", "/api/availability?professional=" + encodeURIComponent(pro) + "&fecha=" + encodeURIComponent(fecha)); }
  };
  var D = API_URL ? viaApi : viaSb;

  function petUrl(path) { return path ? sb.storage.from("pet-photos").getPublicUrl(path).data.publicUrl : ""; }
  // Fotos de perfil, de negocio y de equipo (bucket público aparte)
  function profileUrl(path) { return path && sb ? sb.storage.from("profile-photos").getPublicUrl(path).data.publicUrl : ""; }
  // Reduce la imagen a 640 px y la devuelve como JPEG; la sube a la carpeta del usuario y devuelve la ruta
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error("Selecciona una imagen válida.")); return; }
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, 640 / Math.max(im.width, im.height)), cv = document.createElement("canvas");
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { b ? resolve(b) : reject(new Error("No se pudo procesar la imagen.")); }, "image/jpeg", 0.85);
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("No se pudo leer esa imagen.")); };
      im.src = url;
    });
  }
  async function uploadProfilePhoto(file) {
    var blob = await shrinkImage(file);
    var path = S.uid + "/" + uuid() + ".jpg";
    var up = await sb.storage.from("profile-photos").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    return path;
  }
  function removeProfilePhoto(path) { if (path && sb) sb.storage.from("profile-photos").remove([path]); }
  // Pinta una foto dentro de un contenedor (avatar, caja, etc.); si no carga, deja el contenido de respaldo
  function paintPhoto(el, url, alt) {
    if (!el) return;
    if (!url) { el.classList.remove("has-img"); return; }
    var im = h("img"), orig = el.textContent; im.src = url; im.alt = alt || ""; im.loading = "lazy";
    im.onerror = function () { im.remove(); el.classList.remove("has-img"); el.textContent = orig; };
    el.classList.add("has-img"); el.textContent = ""; el.appendChild(im);
  }
  function mapPet(r) { return { id: r.id, nombre: r.nombre, especie: r.especie, raza: r.raza, edad: r.edad, descripcion: r.descripcion || "", path: r.foto_path, foto: petUrl(r.foto_path) }; }
  function mapRes(r) {
    return { id: r.id, professional_id: r.professional_id, servicio: r.servicio, profesional: (r.professionals || {}).nombre || "",
      direccion: (r.professionals || {}).direccion || "", telefono: (r.professionals || {}).telefono || "",
      mascota: r.pet_nombre, fecha: fmtFecha(r.fecha), hora: fmtHora(r.hora), duracion: r.duracion_min + " min", precio: money(r.precio), estado: r.estado };
  }
  function mapNotif(r) { return { id: r.id, texto: r.texto, t: Date.parse(r.created_at), leida: r.leida }; }

  async function loadAll() {
    var uid = S.uid;
    var rs = await Promise.all([
      D.me.get(), D.pets.list(), D.bookings.list(), D.notifs.list(), D.pros.list()
    ]);
    var err = rs.filter(function (x) { return x.error; })[0];
    if (err) throw err.error;
    var u = S.user, meta = u.user_metadata || {};
    var p = rs[0].data || {};
    S.perfil = {
      nombre: p.nombre || meta.nombre || meta.full_name || meta.name || (u.email || "").split("@")[0],
      correo: p.correo || u.email || "", telefono: p.telefono || "", ciudad: p.ciudad || "Bogotá",
      fotoPath: p.foto_path || null, foto: profileUrl(p.foto_path)
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
  /* La barra muestra primero lo guardado de la última visita (si es del mismo usuario) y luego lo actualiza,
     para que nunca aparezca un nombre o contador de ejemplo mientras cargan los datos. */
  var CACHE_KEY = "petgo_nav";
  function currentUid() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^sb-.+-auth-token$/.test(k)) {
          var v = JSON.parse(localStorage.getItem(k));
          return (v && v.user && v.user.id) || (v && v.currentSession && v.currentSession.user && v.currentSession.user.id) || null;
        }
      }
    } catch (e) { /* sin almacenamiento */ }
    return null;
  }
  function paintNav(nombre, unread, foto) {
    $$(".bell").forEach(function (b) {
      var c = $(".count", b);
      if (!unread) { if (c) c.remove(); }
      else { if (!c) { c = h("span", "count"); b.appendChild(c); } c.textContent = unread; }
    });
    if (nombre) {
      $$(".js-name").forEach(function (e) { e.textContent = nombre; });
      $$(".js-initial").forEach(function (e) {
        if (foto) paintPhoto(e, foto, nombre);
        else { e.classList.remove("has-img"); e.textContent = nombre.charAt(0).toUpperCase(); }
      });
    }
  }
  function clearNavCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignorar */ } }
  (function paintFromCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      var uid = currentUid();
      if (c && uid && c.uid === uid) paintNav(c.nombre, c.unread, c.foto);
    } catch (e) { /* ignorar */ }
  })();

  function refreshNav() {
    var n = S.notifs.filter(function (x) { return !x.leida; }).length;
    var nombre = S.perfil.nombre || "Usuario";
    paintNav(nombre, n, S.perfil.foto);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: S.uid, nombre: nombre, unread: n, foto: S.perfil.foto || "" })); } catch (e) { /* ignorar */ }
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
      if (next && /^[\w\-]+\.html(\?.*)?$/.test(next)) { location.href = next; return; }
      try { sessionStorage.removeItem("petgo_preview"); } catch (er) { /* ignorar */ }
      S.uid = r.data.user.id;
      location.href = await homeFor();
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
      var checked = document.querySelector('input[name="account-role"]:checked');
      var esProveedor = !!checked && checked.value === "proveedor";
      var negocio = null;
      if (esProveedor) {
        var tipo = document.querySelector('input[name="provider-type"]:checked').value;
        var businessName = $("#business-name").value.trim();
        if (!businessName) { fail("Escribe el nombre comercial o profesional."); return; }
        var cant = Number($("#business-size").value);
        if (tipo === "empresa" && (!Number.isInteger(cant) || cant < 2 || cant > 500)) { fail("Una empresa debe indicar entre 2 y 500 personas."); return; }
        var direccion = $("#business-address").value.trim(), telefono = $("#business-phone").value.trim();
        if (tipo === "empresa" && !direccion) { fail("Una empresa debe indicar la dirección de su local."); return; }
        if (telefono && !/^[0-9+()\s-]{7,20}$/.test(telefono)) { fail("Revisa el teléfono: solo números, espacios, + ( ) y guiones."); return; }
        negocio = { tipo: tipo, nombre: businessName, zona: $("#business-zone").value.trim() || "Bogotá", descripcion: ($("#business-desc").value || "").trim(), direccion: direccion, telefono: telefono };
        if (tipo === "empresa") negocio.cantidad = cant;
        // Se guarda para crear el negocio la primera vez que se abre el panel (también sirve si hay que confirmar el correo)
        try { localStorage.setItem("petgo_business_pending", JSON.stringify(negocio)); } catch (er) { /* ignorar */ }
      }
      if (!sb) { fail("No se pudo conectar con el servidor."); return; }
      reg.classList.add("disabled");
      var r = await sb.auth.signUp({
        email: $("#r-correo").value.trim(), password: $("#r-pass").value,
        options: { data: esProveedor ? { nombre: $("#r-nombre").value.trim(), rol: "proveedor" } : { nombre: $("#r-nombre").value.trim() } }
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
      try { sessionStorage.removeItem(BK_KEY); sessionStorage.removeItem("petgo_preview"); } catch (er) { /* ignorar */ }
      location.href = esProveedor ? "proveedor-panel.html" : "estado-usuario-nuevo.html";
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
  function isAvailable(p) { return p.disponible !== false && p.estado !== "No disponible" && p.estado !== "no disponible"; }
  function providerKind(p) {
    if (p.tipo === "individual") return "Profesional independiente";
    if (p.tipo === "empresa") return "Empresa" + (p.trabajadores ? " · " + p.trabajadores + " trabajadores" : "");
    return /happy.walk|spa.canino/i.test(p.nombre) ? "Profesional independiente" : "Empresa de servicios";
  }
  function renderResultados() {
    var box = $("#results"); if (!box) return;
    var svc = /paseos/.test(PAGE) ? "paseo" : "bano";
    var det = svc === "paseo" ? "detalle-paseos.html" : "detalle-banos.html";
    var all = S.pros.filter(function (p) { return p.servicio === svc; });
    var filter = $("#provider-filter"), order = $("#provider-sort");
    var list = all.filter(function (p) { return !filter || filter.value === "todos" || (filter.value === "disponibles" ? isAvailable(p) : (filter.value === "individual" ? providerKind(p).includes("independiente") : providerKind(p).includes("Empresa"))); });
    if (order) list.sort(function (a,b) { return order.value === "precio" ? a.precio-b.precio : order.value === "calificacion" ? b.rating-a.rating : String(a.nombre).localeCompare(String(b.nombre)); });
    var cnt = $("#res-count"); if (cnt) cnt.textContent = all.length ? all.length + (all.length === 1 ? " oferta de " : " ofertas de ") + (svc === "paseo" ? "paseos" : "baño y peluquería") + ". Compara precios, profesionales y disponibilidad." : "Todavía no hay ofertas publicadas.";
    box.innerHTML = "";
    if (!all.length) {
      var em = h("div", "empty-catalog");
      add(em, h("div", "big", svc === "paseo" ? "🐕" : "🛁"), h("h2", "h3", "Aún no hay profesionales en esta categoría"), h("p", "hist-note", "Cuando un proveedor registrado publique este servicio, aparecerá aquí."));
      box.appendChild(em); return;
    }
    if (!list.length) { box.appendChild(h("p", "hist-note", "No hay ofertas para este filtro. Prueba otra opción.")); return; }
    list.forEach(function (p) {
      var card = h("article", "offer-card");
      var top = h("div", "offer-top"), ico=h("div", "offer-avatar", svc === "paseo" ? "🐕" : "🛁"), info=h("div", "offer-identity");
      if (p.foto_path) paintPhoto(ico, profileUrl(p.foto_path), p.nombre);
      add(info, h("h2", "offer-name", p.nombre), h("span", "offer-kind", providerKind(p)), h("p", "offer-meta", "⭐ " + (p.resenas ? p.rating + " (" + p.resenas + " reseñas)" : "Nuevo") + "  ·  📍 " + (p.direccion ? p.direccion + ", " : "") + p.zona));
      if (p.horario) add(info, h("p", "offer-meta", "🕒 " + p.horario));
      add(top, ico, info, h("span", "badge " + (isAvailable(p)?"ok":"no"), isAvailable(p)?"Disponible":"Sin cupos"));
      var foot=h("div", "offer-bottom"), price=h("div", "offer-price"), link=h("a", "btn sm" + (isAvailable(p)?"":" sec"), isAvailable(p)?"Ver oferta":"Ver perfil");
      add(price, h("small", null, "Desde"), h("strong", null, money(p.precio)), h("small", null, p.duracion_min + " minutos por sesión"));
      link.href=det+"?pro="+encodeURIComponent(p.id);
      add(foot, price, link);
      add(card,top,h("p","offer-description",p.descripcion),foot); box.appendChild(card);
    });
    [filter, order].forEach(function (control) { if (control && !control.dataset.bound) { control.dataset.bound="1"; control.addEventListener("change",renderResultados); } });
  }
  function renderDetalle() {
    var root = $(".detail[data-default]"); if (!root) return;
    var p = getPro(query("pro")); 
    if (!p) {
      var info0 = $(".detail .info");
      if (info0) { info0.innerHTML = ""; var em = h("div", "empty-catalog"), back = h("a", "btn", "Ver profesionales"); back.href = /banos/.test(PAGE) ? "resultados-banos.html" : "resultados-paseos.html";
        add(em, h("div", "big", "🐾"), h("h2", "h3", "Este profesional no está disponible"), h("p", "hist-note", "Puede que ya no ofrezca este servicio."), back); info0.appendChild(em); }
      var bk = $(".detail .book"); if (bk) bk.hidden = true;
      return;
    }
    var vals = { nombre:p.nombre, rating:p.resenas?String(p.rating):"Nuevo", meta:"(" + p.resenas + " reseñas) · Bogotá", precio:money(p.precio), duracion:p.duracion_min+" min", zona:p.zona, detalle:p.detalle||p.descripcion, horario:p.horario||"Consultar disponibilidad" };
    $$('[data-d]').forEach(function(el) { el.textContent=vals[el.dataset.d]; });
    document.title=p.nombre+" · PetGo";
    var type=$("#provider-type"); if(type) type.textContent=providerKind(p);
    var status=$(".detail .head .badge"); if(status) { status.textContent=isAvailable(p)?"Disponible":"Sin cupos"; status.className="badge "+(isAvailable(p)?"ok":"no"); }
    var a=$("[data-reservar]");
    a.dataset.pro=p.id; a.dataset.profesional=p.nombre; a.dataset.duracion=vals.duracion; a.dataset.precio=vals.precio; a.dataset.servicio=servicioNombre(p.servicio); a.dataset.volver=PAGE+".html?pro="+encodeURIComponent(p.id);
    if(!isAvailable(p)) { a.textContent="Actualmente sin cupos"; a.removeAttribute("href"); a.setAttribute("aria-disabled","true"); a.classList.add("disabled"); }
    if (DEMO || /^local-/.test(p.id)) {
      a.textContent="Reserva disponible al conectar el backend";
      a.removeAttribute("href"); a.setAttribute("aria-disabled","true"); a.classList.add("disabled");
    }
    var ph=$("#d-photo");
    if(ph && p.foto_path) { var u=profileUrl(p.foto_path), im=h("img"); im.src=u; im.alt=p.nombre; im.onerror=function(){ im.remove(); ph.classList.remove("has-img"); }; ph.classList.add("has-img"); ph.appendChild(im); }
    var dir=$("#d-lugar");
    if(dir && p.direccion) {
      dir.hidden=false; $("#d-direccion").textContent=p.direccion + (p.zona ? " · " + p.zona : "");
      $("#d-mapa").href="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(p.direccion+", "+(p.zona||"")+", Bogotá, Colombia");
    }
    var con=$("#d-contacto");
    if(con && p.telefono) {
      var digits=String(p.telefono).replace(/\D/g,""); if(digits.length===10) digits="57"+digits;
      con.hidden=false; var tel=$("#d-tel"); tel.textContent=p.telefono; tel.href="tel:"+p.telefono.replace(/[^\d+]/g,"");
      $("#d-wa").href="https://wa.me/"+digits+"?text="+encodeURIComponent("Hola, vi tu servicio en PetGo y quisiera más información.");
    }
    if(p.business_id && !DEMO) {
      D.team(p.business_id, p.id).then(function(r){
        if(r.error || !r.data || !r.data.length) return;
        var box=$("#d-equipo-lista"); if(!box) return; box.innerHTML="";
        r.data.forEach(function(w){
          var c=h("div","team-card"), av=h("span","avatar",(w.nombre||"?").charAt(0).toUpperCase()), t=h("div");
          if(w.foto_path) paintPhoto(av, profileUrl(w.foto_path), w.nombre);
          add(t,h("b",null,w.nombre),h("small",null,w.funcion||""));
          if(w.descripcion) add(t,h("small",null,w.descripcion));
          add(c,av,t); box.appendChild(c);
        });
        $("#d-equipo").hidden=false;
      });
    }
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
    var proId = bk0.profesionalId || "";
    var pro = getPro(proId);
    if (!pro) { location.replace("servicios.html"); return; }
    var DIAS_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    function trabaja(dow) { return !pro.dias || pro.dias.indexOf(dow) !== -1; }
    function minutos(t) { var p = String(t).split(":"); return (+p[0]) * 60 + (+p[1]); }
    // Horas de inicio posibles ese día: cada 60 min desde que abre, mientras la sesión termine antes de cerrar
    function horasDelDia() {
      var ini = pro.hora_inicio ? minutos(pro.hora_inicio) : 7 * 60, fin = pro.hora_fin ? minutos(pro.hora_fin) : 20 * 60, out = [];
      for (var t = ini; t + (+pro.duracion_min || 30) <= fin && t <= 19 * 60; t += 60) out.push(t);
      return out;
    }
    function etiqueta(t) { var H = Math.floor(t / 60), M = t % 60; return ((H % 12) || 12) + ":" + pad(M) + " " + (H >= 12 ? "PM" : "AM"); }

    var today = new Date(); today.setHours(0, 0, 0, 0);
    var months = [0, 1, 2].map(function (i) { var d = new Date(today.getFullYear(), today.getMonth() + i, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
    var idx = 0, selected = null;
    var hora = null;
    var title = $(".mt", calRoot), prev = $("#cal-prev"), nextBtn = $("#cal-next");
    var days = $(".cal-days", calRoot), selTxt = $("#cal-sel-text");
    var slots = [];
    var grid = $("#slot-grid"), note = $("#slot-note");
    if (note && pro.horario) note.textContent = "Horario de atención: " + pro.horario + ". Elige una fecha para ver las horas; las tachadas ya están ocupadas.";
    var reqId = 0;

    function buildSlots() {
      grid.innerHTML = ""; slots = []; hora = null;
      if (!selected) return;
      var dow = new Date(selected.y, selected.m, selected.d).getDay();
      var horas = trabaja(dow) ? horasDelDia() : [];
      if (!horas.length) { grid.appendChild(h("p", "slot-empty", "Este profesional no atiende ese día. Elige otra fecha.")); return; }
      horas.forEach(function (t) {
        var b = h("button", "slot", etiqueta(t)); b.type = "button"; b.dataset.hora = etiqueta(t);
        b.addEventListener("click", function () {
          if (b.disabled) return;
          slots.forEach(function (x) { x.classList.remove("sel"); });
          b.classList.add("sel"); hora = b.dataset.hora; selTxt.classList.remove("warn");
        });
        grid.appendChild(b); slots.push(b);
      });
    }

    function fechaStr(s) { return s.d + " de " + MESES[s.m] + " de " + s.y; }
    function fechaIso(s) { return s.y + "-" + pad(s.m + 1) + "-" + pad(s.d); }

    async function refreshSlots() {
      var my = ++reqId;
      buildSlots();
      if (!selected || !slots.length) return;
      var r = await D.slots(proId, fechaIso(selected));
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
        var disabled = new Date(cur.y, cur.m, d) < today || !trabaja(new Date(cur.y, cur.m, d).getDay());
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
          res = await D.bookings.update(rid, { fecha: fecha, hora: hr });
        } else {
          var pro = getPro(b.profesionalId);
          if (!pro) { confirmBtn.classList.remove("disabled"); fail("Elige primero un profesional."); return; }
          var pet = petByName(v.mascota);
          res = await D.bookings.create({ professional_id: pro.id, pet_id: pet ? pet.id : null, pet_nombre: v.mascota, fecha: fecha, hora: hr });
        }
        confirmBtn.classList.remove("disabled");
        if (res.error) {
          var code = res.error.code;
          if (code === "horario_ocupado") { location.href = "estado-horario-ocupado.html"; return; }
          if (code === "limite_reservas") { location.href = "estado-limite-de-reservas.html"; return; }
          if (code === "fecha_pasada") { fail("Esa fecha ya pasó. Elige otra."); return; }
          if (code === "fuera_de_horario") { fail("Ese día u hora está fuera del horario de atención del profesional. Elige otro horario."); return; }
          if (code === "reserva_cancelada") { fail("Esa reserva ya está cancelada."); return; }
          fail(code === "sin_conexion" ? res.error.message : "No se pudo guardar la reserva. Intenta de nuevo.", res.error);
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
    $$("[data-row]").forEach(function (row) { row.hidden = !res[row.dataset.row]; });
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
        var r = await D.bookings.cancel(res.id);
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
          var r = await D.notifs.read(n.id);
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
      var r = await D.notifs.readAll();
      if (r.error) { fail("No se pudieron marcar como leídas.", r.error); return; }
      S.notifs.forEach(function (n) { n.leida = true; });
      render(); refreshNav();
    });
  }

  /* ================= Mis mascotas ================= */
  function setupMascotas() {
    var form = $("#pet-form");
    if (!form) return;
    var list = $("#pet-list"), count = $("#pet-count");
    var fNombre = $("#f-nombre"), fEsp = $("#f-especie"), fRaza = $("#f-raza"), fEdad = $("#f-edad"), fDesc = $("#f-desc");
    var fFoto = $("#f-foto"), fotoTx = $("#foto-tx"), delBtn = $("#btn-delete-pet"), saveBtn = $("#save-pet");
    var current = null, fotoBlob = null, saving = false;

    function renderPets() {
      list.innerHTML = "";
      if (count) count.textContent = S.pets.length + (S.pets.length === 1 ? " perfil" : " perfiles");
      if (!S.pets.length) list.appendChild(h("p", "hist-note", "Todavía no tienes mascotas. Pulsa Agregar para crear un perfil."));
      S.pets.forEach(function (p) {
        var row = h("div", "pet-line"), info = h("div", "pet-line-info"), edit = h("button", "btn sec sm", "Editar");
        edit.type = "button";
        add(info, h("strong", null, p.nombre), h("span", null, (p.raza || p.especie || "Mascota") + " · " + (p.edad || "Edad no indicada") + " · " + (p.especie || "Perro")));
        if (p.descripcion) add(info, h("small", null, p.descripcion));
        edit.addEventListener("click", function () { openForm(p); });
        add(row, petIcon(p), info, edit);
        list.appendChild(row);
      });
    }
    function closeForm() {
      form.hidden = true; current = null; fotoBlob = null; form.reset();
      fotoTx.textContent = "Subir foto (opcional)";
    }
    function openForm(p) {
      current = p || null; fotoBlob = null; form.hidden = false;
      $("#pet-form-title").textContent = p ? "Editar a " + p.nombre : "Agregar mascota";
      saveBtn.textContent = p ? "Guardar cambios" : "Guardar mascota";
      delBtn.hidden = !p;
      fNombre.value = p ? p.nombre : ""; fEsp.value = p ? (p.especie || "Perro") : "Perro";
      fRaza.value = p ? (p.raza || "") : ""; fEdad.value = p ? (p.edad || "") : ""; fDesc.value = p ? (p.descripcion || "") : "";
      fFoto.value = ""; fotoTx.textContent = p && p.foto ? "Cambiar foto" : "Subir foto (opcional)";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      fNombre.focus({ preventScroll: true });
    }
    renderPets();

    // La foto se reduce (máx. 640 px) antes de subirla.
    fFoto.addEventListener("change", function () {
      var f = fFoto.files && fFoto.files[0];
      fotoBlob = null;
      if (!f) return;
      if (!/^image\//.test(f.type)) { toast("Selecciona una imagen válida.", true); fFoto.value = ""; return; }
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
      im.onerror = function () { fotoTx.textContent = "Subir foto (opcional)"; toast("No se pudo leer esa imagen.", true); };
      im.src = url;
    });

    $("#btn-add").addEventListener("click", function (e) { e.preventDefault(); openForm(null); });
    $("#cancel-pet").addEventListener("click", function (e) { e.preventDefault(); closeForm(); });

    delBtn.addEventListener("click", async function () {
      if (!current || !confirm("¿Eliminar a " + current.nombre + "?")) return;
      delBtn.disabled = true;
      var r = await D.pets.remove(current.id);
      delBtn.disabled = false;
      if (r.error) { fail("No se pudo eliminar la mascota.", r.error); return; }
      if (current.path) sb.storage.from("pet-photos").remove([current.path]);
      var id = current.id;
      S.pets = S.pets.filter(function (x) { return x.id !== id; });
      closeForm(); renderPets();
    });

    async function savePet() {
      if (saving) return;
      var nombre = fNombre.value.trim(), edad = fEdad.value.trim();
      if (!nombre) { toast("Escribe el nombre de la mascota.", true); fNombre.focus(); return; }
      if (edad && !/^\d{1,2}(\s*años?)?$/i.test(edad)) { toast("Indica la edad en años, por ejemplo 3.", true); fEdad.focus(); return; }
      saving = true; saveBtn.classList.add("disabled");
      try {
        var path = null;
        if (fotoBlob) {
          path = S.uid + "/" + uuid() + ".jpg";
          var up = await sb.storage.from("pet-photos").upload(path, fotoBlob, { contentType: "image/jpeg" });
          if (up.error) { fail("No se pudo subir la foto.", up.error); path = null; }
        }
        var esp = fEsp.value.trim() || "Perro";
        var data = { nombre: nombre, especie: esp, raza: fRaza.value.trim() || esp, edad: edad || null, descripcion: fDesc.value.trim() };
        var r;
        if (current) {
          if (path) data.foto_path = path;
          r = await D.pets.update(current.id, data);
        } else {
          data.foto_path = path;
          r = await D.pets.create(data);
        }
        if (r.error) {
          if (path) sb.storage.from("pet-photos").remove([path]);
          fail("No se pudo guardar la mascota.", r.error); return;
        }
        var saved = mapPet(r.data);
        if (current) {
          if (path && current.path) sb.storage.from("pet-photos").remove([current.path]);   // se descarta la foto anterior
          S.pets = S.pets.map(function (x) { return x.id === saved.id ? saved : x; });
        } else S.pets.push(saved);
        closeForm(); renderPets();
      } finally { saving = false; saveBtn.classList.remove("disabled"); }
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); savePet(); });
    saveBtn.addEventListener("click", function (e) { e.preventDefault(); savePet(); });
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
    var fotoNueva = null, quitarFoto = false, vistaPrevia = null;
    var fIn = $("#p-foto"), fPrev = $("#p-foto-prev"), fDel = $("#p-foto-quitar");
    function paintFoto() {
      var ini = (S.perfil.nombre || "A").charAt(0).toUpperCase();
      [$("#v-inicial"), fPrev].forEach(function (el) {
        if (!el) return;
        el.classList.remove("has-img"); el.textContent = ini;
        var url = vistaPrevia || (!quitarFoto && S.perfil.foto) || "";
        if (url) paintPhoto(el, url, S.perfil.nombre);
      });
      if (fDel) fDel.hidden = !(vistaPrevia || (!quitarFoto && S.perfil.fotoPath));
    }
    function paint() {
      K.forEach(function (k) { V[k].textContent = S.perfil[k] || "—"; P[k].value = S.perfil[k] || ""; });
      paintFoto();
    }
    paint();
    if (fIn) fIn.addEventListener("change", function () {
      var f = fIn.files && fIn.files[0]; if (!f) return;
      if (!/^image\//.test(f.type)) { toast("Selecciona una imagen válida.", true); fIn.value = ""; return; }
      if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
      fotoNueva = f; quitarFoto = false; vistaPrevia = URL.createObjectURL(f); paintFoto();
    });
    if (fDel) fDel.addEventListener("click", function () {
      if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
      fotoNueva = null; vistaPrevia = null; quitarFoto = true; if (fIn) fIn.value = ""; paintFoto();
    });
    function resetFoto() { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); fotoNueva = null; vistaPrevia = null; quitarFoto = false; if (fIn) fIn.value = ""; }
    P.correo.readOnly = true;   // el correo es el de la cuenta; cambiarlo requiere verificación
    function open() { card.classList.add("open"); editRow.hidden = true; flash.classList.remove("show"); }
    function close() { card.classList.remove("open"); editRow.hidden = false; }
    editRow.addEventListener("click", open);
    $("#edit-cancel").addEventListener("click", function () { resetFoto(); paint(); close(); });
    $("#edit-save").addEventListener("click", async function () {
      var patch = { nombre: P.nombre.value.trim() || S.perfil.nombre, telefono: P.telefono.value.trim(), ciudad: P.ciudad.value.trim() || S.perfil.ciudad };
      var viejo = S.perfil.fotoPath, nuevoPath = null;
      try {
        if (fotoNueva) { nuevoPath = await uploadProfilePhoto(fotoNueva); patch.foto_path = nuevoPath; }
        else if (quitarFoto) patch.foto_path = null;
      } catch (er) { fail("No se pudo subir la foto.", er); return; }
      var r = await D.me.update(patch);
      if (r.error) { removeProfilePhoto(nuevoPath); fail("No se pudieron guardar los cambios.", r.error); return; }
      S.perfil.nombre = patch.nombre; S.perfil.telefono = patch.telefono; S.perfil.ciudad = patch.ciudad;
      if ("foto_path" in patch) { S.perfil.fotoPath = patch.foto_path; S.perfil.foto = profileUrl(patch.foto_path); if (viejo) removeProfilePhoto(viejo); }
      resetFoto(); paint(); refreshNav(); close(); flash.classList.add("show");
    });
    var out = $("#btn-logout");
    if (out) out.addEventListener("click", async function (e) {
      e.preventDefault();
      try { sessionStorage.removeItem(BK_KEY); } catch (er) { /* ignorar */ }
      clearNavCache();
      await sb.auth.signOut();
      location.href = "index.html";
    });
  }

  /* ================= Destino según el tipo de cuenta ================= */
  async function homeFor() {
    try {
      var me = await D.me.get();
      if (me.data && me.data.rol === "proveedor") return "proveedor-panel.html";
    } catch (e) { /* si falla, se va al panel de dueño */ }
    return "dashboard.html";
  }

  /* ================= Panel de proveedores (lo dibuja petgo-extra.js) ================= */
  var readyResolve;
  window.PetGo = {
    profileUrl: profileUrl, uploadPhoto: uploadProfilePhoto, removePhoto: removeProfilePhoto, paintPhoto: paintPhoto,
    ready: new Promise(function (res) { readyResolve = res; }),
    logout: async function () {
      try { sessionStorage.removeItem(BK_KEY); sessionStorage.removeItem("petgo_preview"); } catch (er) { /* ignorar */ }
      clearNavCache();
      try { if (sb) await sb.auth.signOut(); } catch (er) { console.warn("No fue posible cerrar la sesión:", er); }
      location.href = "login.html";
    }
  };

  /* ================= Arranque ================= */
  async function boot() {
    try {
      if (DEMO && PAGE !== "registro" && PAGE !== "login" && PAGE !== "proveedor-panel") {
        loadDemo();
        renderResultados();renderDetalle();setupMascotas();setupDashboard();loadPhotos();
        $$(".nav-actions .profile-pill .js-name").forEach(function(el){el.textContent="Vista previa";});
        return;
      }
      var publica = PUBLICAS.indexOf(PAGE) !== -1;
      if (!sb) {
        if (!publica) { toast("No se pudo cargar Supabase. Revisa tu conexión.", true); readyResolve(null); }
        loadPhotos(); setupLogin(); setupRegistro(); setupOAuth();
        return;
      }
      var sess = (await sb.auth.getSession()).data.session;

      // Páginas públicas
      if (publica) {
        // Con sesión abierta, el login y el registro llevan directo al panel
        if (sess && (PAGE === "login" || PAGE === "registro") && !query("stay")) { S.uid = sess.user.id; location.replace(await homeFor()); return; }
        loadPhotos(); setupLogin(); setupRegistro(); setupOAuth();
        return;
      }
      // Páginas privadas
      if (!sess) {
        clearNavCache();
        if (PAGE === "proveedor-panel") readyResolve(null);
        location.replace("login.html?next=" + encodeURIComponent(PAGE + ".html" + location.search));
        return;
      }
      S.uid = sess.user.id; S.user = sess.user;
      if (PAGE === "proveedor-panel") {
        window.PetGo.D = D;
        readyResolve({ D: D, toast: toast, uid: S.uid });
        return;
      }
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
