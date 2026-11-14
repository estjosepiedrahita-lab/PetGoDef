/* PetGo — interacciones del prototipo conectadas a Supabase.
   Auth, mascotas, reservas, notificaciones y perfil viven en la base de datos (ver supabase/schema.sql). */
(function () {
  "use strict";

  var MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var MESES_CAP = MESES.map(function (m) { return m.charAt(0).toUpperCase() + m.slice(1); });
  var LIMITE = 5;
  var BK_KEY = "petgo_booking";
  var PUBLICAS = ["", "index", "login", "registro", "mapa", "proveedor-panel"];

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
    S.pros=[
      {id:"happy-walk",nombre:"Happy Walk",tipo:"individual",servicio:"paseo",precio:18000,duracion_min:30,descripcion:"Paseos individuales y personalizados con acompañamiento durante todo el recorrido.",detalle:"Paseos personalizados para tu mascota.",horario:"Lun–Sáb, 7:00–19:00",zona:"Usaquén",rating:4.8,resenas:96,disponible:true},
      {id:"paseos-petgo",nombre:"Paseos PetGo",tipo:"empresa",trabajadores:4,servicio:"paseo",precio:20000,duracion_min:30,descripcion:"Paseos supervisados con seguimiento GPS y un equipo de cuidadores.",horario:"Lun–Sáb, 7:00–19:00",zona:"Chapinero",rating:4.9,resenas:128,disponible:true},
      {id:"patitas-felices",nombre:"Patitas Felices",tipo:"empresa",trabajadores:6,servicio:"paseo",precio:22000,duracion_min:45,descripcion:"Paseos grupales e individuales con paseadores capacitados.",horario:"Lun–Vie, 8:00–17:00",zona:"Suba",rating:4.7,resenas:74,disponible:false},
      {id:"petgo-grooming",nombre:"PetGo Grooming",tipo:"empresa",trabajadores:3,servicio:"bano",precio:35000,duracion_min:90,descripcion:"Baños y peluquería profesional para mascotas.",horario:"Lun–Sáb, 8:00–18:00",zona:"Chapinero",rating:4.9,resenas:142,disponible:true},
      {id:"spa-canino",nombre:"Spa Canino Bogotá",tipo:"individual",servicio:"bano",precio:28000,duracion_min:60,descripcion:"Baños individuales con productos suaves y cuidado personalizado.",horario:"Mar–Sáb, 9:00–17:00",zona:"Usaquén",rating:4.8,resenas:96,disponible:true}
    ];
    S.pros=S.pros.map(function(p){return Object.assign({},p,readLocal("petgo_offer_"+p.id,{}));});
    var b=readLocal("petgo_business",null);
    if(b) readLocal("petgo_business_offers",[]).forEach(function(o){
      S.pros.push({id:o.id,nombre:b.nombre,tipo:b.tipo,trabajadores:(b.empleados||[]).length,servicio:o.servicio,precio:+o.precio,duracion_min:+o.duracion_min,descripcion:o.descripcion,detalle:o.descripcion,horario:o.horario,zona:b.zona,disponible:o.disponible,rating:0,resenas:0});
    });
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
      remove: function (id) { return sbq(sb.from("pets").delete().eq("id", id)); }
    },
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
      remove: function (id) { return call("DELETE", "/api/pets/" + encodeURIComponent(id)); }
    },
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
  function mapPet(r) { return { id: r.id, nombre: r.nombre, especie: r.especie, raza: r.raza, edad: r.edad, path: r.foto_path, foto: petUrl(r.foto_path) }; }
  function mapRes(r) {
    return { id: r.id, professional_id: r.professional_id, servicio: r.servicio, profesional: (r.professionals || {}).nombre || "",
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
      correo: p.correo || u.email || "", telefono: p.telefono || "", ciudad: p.ciudad || "Bogotá"
    };
    S.pets = rs[1].data.map(mapPet);
    S.reservas = rs[2].data.map(mapRes);
    S.notifs = rs[3].data.map(mapNotif);
    S.pros = rs[4].data.map(function (p) {
      var changes = readLocal("petgo_offer_" + p.id, {});
      return Object.assign({}, p, changes);
    });
    var demo = readLocal("petgo_business", null);
    if (demo && demo.nombre) {
      readLocal("petgo_business_offers", []).forEach(function (o) {
        if (o.activo !== false && !S.pros.some(function (p) { return p.id === o.id; })) {
          S.pros.push({ id:o.id, nombre:demo.nombre, servicio:o.servicio, precio:Number(o.precio), duracion_min:Number(o.duracion_min), descripcion:o.descripcion, detalle:o.descripcion, zona:demo.zona || "Bogotá", horario:o.horario, disponible:o.disponible, rating:0, resenas:0, tipo:demo.tipo, trabajadores:(demo.empleados || []).length });
        }
      });
    }
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
  function paintNav(nombre, unread) {
    $$(".bell").forEach(function (b) {
      var c = $(".count", b);
      if (!unread) { if (c) c.remove(); }
      else { if (!c) { c = h("span", "count"); b.appendChild(c); } c.textContent = unread; }
    });
    if (nombre) {
      $$(".js-name").forEach(function (e) { e.textContent = nombre; });
      $$(".js-initial").forEach(function (e) { e.textContent = nombre.charAt(0).toUpperCase(); });
    }
  }
  function clearNavCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignorar */ } }
  (function paintFromCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      var uid = currentUid();
      if (c && uid && c.uid === uid) paintNav(c.nombre, c.unread);
    } catch (e) { /* ignorar */ }
  })();

  function refreshNav() {
    var n = S.notifs.filter(function (x) { return !x.leida; }).length;
    var nombre = S.perfil.nombre || "Usuario";
    paintNav(nombre, n);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: S.uid, nombre: nombre, unread: n })); } catch (e) { /* ignorar */ }
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
      if (document.querySelector('input[name="account-role"]:checked') && document.querySelector('input[name="account-role"]:checked').value === "proveedor") {
        var tipo = document.querySelector('input[name="provider-type"]:checked').value;
        var businessName = $("#business-name").value.trim();
        if (!businessName) { fail("Escribe el nombre comercial o profesional."); return; }
        if (tipo === "empresa" && (!Number($("#business-size").value) || Number($("#business-size").value) < 2)) { fail("Una empresa debe indicar al menos dos trabajadores."); return; }
        var business={ tipo:tipo, nombre:businessName, responsable:$("#r-nombre").value.trim(), correo:$("#r-correo").value.trim(), zona:$("#business-zone").value.trim()||"Bogotá", descripcion:$("#business-desc").value.trim(), cantidad:tipo==="empresa"?Number($("#business-size").value):1, empleados:[] };
        localStorage.setItem("petgo_business",JSON.stringify(business));
        localStorage.setItem("petgo_business_offers", JSON.stringify([]));
        location.href="proveedor-panel.html"; return;
      }
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
    if (order) list.sort(function (a,b) { return order.value === "precio" ? a.precio-b.precio : order.value === "calificacion" ? b.rating-a.rating : String(a.zona).localeCompare(String(b.zona)); });
    var cnt = $("#res-count"); if (cnt) cnt.textContent = all.length + " ofertas de " + (svc === "paseo" ? "paseos" : "baño y peluquería") + " en Bogotá. Compara precios, profesionales y disponibilidad.";
    box.innerHTML = "";
    if (!list.length) { box.appendChild(h("p", "hist-note", "No hay ofertas para este filtro. Prueba otra opción.")); return; }
    list.forEach(function (p) {
      var card = h("article", "offer-card");
      var top = h("div", "offer-top"), ico=h("div", "offer-avatar", svc === "paseo" ? "🐕" : "🛁"), info=h("div", "offer-identity");
      add(info, h("h2", "offer-name", p.nombre), h("span", "offer-kind", providerKind(p)), h("p", "offer-meta", "⭐ " + (p.resenas ? p.rating + " (" + p.resenas + " reseñas)" : "Nuevo") + "  ·  📍 " + p.zona));
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
    var p = getPro(query("pro")) || getPro(root.dataset.default); if (!p) return;
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
    var ph=$("#d-photo"); if(ph) ph.setAttribute("data-img","assets/img/pro-"+p.id+".jpg");
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
          res = await D.bookings.update(rid, { fecha: fecha, hora: hr });
        } else {
          var pro = getPro(b.profesionalId || "happy-walk");
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
    var form=$("#pet-form"); if(!form) return;
    var list=$("#pet-list"), addBtn=$("#btn-add"), fNombre=$("#f-nombre"), fEsp=$("#f-especie"), fRaza=$("#f-raza"), fEdad=$("#f-edad"), fFoto=$("#f-foto"), photoLabel=$("#foto-tx");
    var currentId=null, photoData="";
    var key="petgo_pets_demo_"+(S.uid||"guest");
    var demo=readLocal(key,{ added:[], edits:{}, deleted:[] });
    function allPets() { return S.pets.filter(function(p){return demo.deleted.indexOf(p.id)<0;}).map(function(p){return Object.assign({},p,demo.edits[p.id]||{});}).concat(demo.added); }
    function persist() { try { localStorage.setItem(key,JSON.stringify(demo)); } catch(e){toast("El almacenamiento local está lleno. Prueba sin fotografía.",true);} }
    function close() {form.hidden=true; currentId=null; form.reset(); photoData=""; photoLabel.textContent="Subir foto (opcional)";}
    function open(p) {form.hidden=false;currentId=p?p.id:null; $("#pet-form-title").textContent=p?"Editar a "+p.nombre:"Agregar mascota"; $("#save-pet").textContent=p?"Guardar cambios":"Guardar mascota"; $("#btn-delete-pet").hidden=!p; fNombre.value=p?p.nombre:"";fEsp.value=p?p.especie||"Perro":"Perro";fRaza.value=p?p.raza||"":"";fEdad.value=p?p.edad||"":"";photoData=p?p.foto||"":""; form.scrollIntoView({behavior:"smooth",block:"start"}); fNombre.focus({preventScroll:true});}
    function render() {
      list.innerHTML=""; var pets=allPets(); var count=$("#pet-count");if(count) count.textContent=pets.length+" perfiles";
      if(!pets.length) list.appendChild(h("p","hist-note","Todavía no tienes mascotas. Pulsa Agregar para crear un perfil."));
      pets.forEach(function(p){
        var row=h("div","pet-line"), info=h("div","pet-line-info"), edit=h("button","btn sec sm","Editar");edit.type="button";
        add(info,h("strong",null,p.nombre),h("span",null,(p.raza||p.especie||"Mascota")+" · "+(p.edad||"Edad no indicada")+" · "+(p.especie||"Perro")));
        edit.addEventListener("click",function(){open(p);}); add(row,petIcon(p),info,edit); list.appendChild(row);
      });
    }
    addBtn.addEventListener("click",function(e){e.preventDefault();open(null);});
    $("#cancel-pet").addEventListener("click",close);
    $("#btn-delete-pet").addEventListener("click",function(){if(!currentId)return;var p=allPets().find(function(x){return x.id===currentId;});if(!confirm("¿Eliminar a "+(p?p.nombre:"esta mascota")+"?"))return;demo.added=demo.added.filter(function(x){return x.id!==currentId;});if(S.pets.some(function(x){return x.id===currentId;}))demo.deleted.push(currentId);delete demo.edits[currentId];persist();close();render();toast("Mascota eliminada de esta demostración.");});
    fFoto.addEventListener("change",function(){var f=fFoto.files[0];if(!f)return;if(!f.type.startsWith("image/")){toast("Selecciona una imagen válida.",true);return;}photoLabel.textContent=f.name; var img=new Image(),reader=new FileReader();reader.onload=function(){img.onload=function(){var max=300,k=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement("canvas");canvas.width=Math.round(img.width*k);canvas.height=Math.round(img.height*k);canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);photoData=canvas.toDataURL("image/jpeg",0.68);};img.src=reader.result;};reader.readAsDataURL(f);});
    form.addEventListener("submit",function(e){e.preventDefault();var name=fNombre.value.trim(),age=fEdad.value.trim();if(!name){toast("Escribe el nombre de la mascota.",true);fNombre.focus();return;}if(age && !/^\d{1,2}(\s*años?)?$/i.test(age)){toast("Indica la edad en años, por ejemplo 3.",true);return;}var pet={nombre:name,especie:fEsp.value,raza:fRaza.value.trim(),edad:age,foto:photoData};if(currentId){var index=demo.added.findIndex(function(x){return x.id===currentId;});if(index>=0)demo.added[index]=Object.assign({},demo.added[index],pet);else demo.edits[currentId]=pet;}else{pet.id="local-"+uuid();demo.added.push(pet);}persist();close();render();toast("Cambios guardados en este navegador.");});
    render();
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
      var r = await D.me.update(patch);
      if (r.error) { fail("No se pudieron guardar los cambios.", r.error); return; }
      S.perfil.nombre = patch.nombre; S.perfil.telefono = patch.telefono; S.perfil.ciudad = patch.ciudad;
      paint(); refreshNav(); close(); flash.classList.add("show");
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

  /* ================= Arranque ================= */
  async function boot() {
    try {
      if (DEMO && PAGE !== "registro" && PAGE !== "login") {
        loadDemo();
        renderResultados();renderDetalle();setupMascotas();setupDashboard();loadPhotos();
        $$(".nav-actions .profile-pill .js-name").forEach(function(el){el.textContent="Vista previa";});
        return;
      }
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
        clearNavCache();
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
