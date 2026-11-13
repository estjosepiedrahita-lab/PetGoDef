'use strict';
// Supabase simulado (Auth + PostgREST + reglas del schema.sql) para probar la API sin internet.
const http = require('http');

const KEY = 'sb_publishable_test';
let n = 0;
const uid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
const iso = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

function create() {
  const state = { users: {}, profiles: [], pets: [], bookings: [], notifications: [], professionals: [], calls: [] };
  const pros = [
    ['happy-walk', 'paseo', 'Happy Walk', 18000, 30], ['paseos-petgo', 'paseo', 'Paseos PetGo', 20000, 30],
    ['petgo-grooming', 'bano', 'PetGo Grooming', 35000, 90]
  ];
  state.professionals = pros.map((p) => ({ id: p[0], servicio: p[1], nombre: p[2], zona: 'Bogotá', descripcion: 'd', detalle: 'd', precio: p[3], duracion_min: p[4], rating: 4.8, resenas: 10, horario: 'Lun–Sáb', activo: true }));

  function addUser(email) {
    const id = uid();
    state.users[id] = { id, email };
    state.profiles.push({ id, nombre: email.split('@')[0], correo: email, telefono: '', ciudad: 'Bogotá', created_at: iso() });
    return { id, token: 'tok-' + id, email };
  }
  const notify = (u, texto) => state.notifications.push({ id: uid(), user_id: u, texto, leida: false, created_at: iso() });

  function who(req) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!m) return { anon: true };
    if (m[1] === KEY) return { anon: true };
    const mm = /^tok-(.+)$/.exec(m[1]);
    if (mm && state.users[mm[1]]) return { id: mm[1] };
    return { invalid: true };
  }

  const err = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ code, message })); };
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };

  function scoped(table, w) {
    const rows = state[table];
    if (table === 'professionals') return rows.filter((r) => r.activo);
    if (w.anon) return [];
    return rows.filter((r) => (table === 'profiles' ? r.id : r.user_id) === w.id);
  }
  function applyQuery(rows, q) {
    let out = rows.slice();
    for (const [k, val] of q) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      const m = /^eq\.(.*)$/.exec(val);
      if (m) out = out.filter((r) => String(r[k]) === m[1]);
    }
    const order = q.get('order');
    if (order) order.split(',').reverse().forEach((o) => {
      const [c, d] = o.split('.');
      out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (d === 'desc' ? -1 : 1));
    });
    if (q.get('limit')) out = out.slice(0, Number(q.get('limit')));
    return out;
  }
  const embed = (table, rows, q) => !(table === 'bookings' && /professionals\(nombre\)/.test(q.get('select') || ''))
    ? rows.map((r) => ({ ...r }))
    : rows.map((r) => ({ ...r, professionals: { nombre: (state.professionals.find((p) => p.id === r.professional_id) || {}).nombre } }));
  const slotTaken = (b, exclude) => state.bookings.some((x) => x.id !== exclude && x.estado === 'confirmada' && x.professional_id === b.professional_id && x.fecha === b.fecha && x.hora.slice(0, 5) === b.hora.slice(0, 5));

  function readBody(req) {
    return new Promise((r) => { let t = ''; req.on('data', (c) => (t += c)); req.on('end', () => r(t ? JSON.parse(t) : undefined)); });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    state.calls.push(req.method + ' ' + url.pathname);
    if (req.headers.apikey !== KEY) return err(res, 401, 'PGRST301', 'No API key');
    const w = who(req);
    if (url.pathname === '/auth/v1/user') {
      if (w.invalid || w.anon) return json(res, 401, { msg: 'invalid JWT' });
      return json(res, 200, state.users[w.id]);
    }
    if (w.invalid) return err(res, 401, 'PGRST301', 'JWT invalid');
    const body = await readBody(req);

    if (url.pathname === '/rest/v1/rpc/slots_ocupados') {
      if (w.anon) return err(res, 401, '42501', 'permission denied');
      return json(res, 200, state.bookings.filter((b) => b.professional_id === body.p_professional && b.fecha === body.p_fecha && b.estado === 'confirmada').map((b) => b.hora.slice(0, 5) + ':00'));
    }
    const mt = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (!mt || !state[mt[1]]) return err(res, 404, 'PGRST205', 'no table');
    const table = mt[1], q = url.searchParams;
    const rep = /return=representation/.test(req.headers.prefer || '');
    const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
    const finish = (status, rows) => {
      const data = embed(table, rows, q);
      if (single) return data.length === 1 ? json(res, status, data[0]) : err(res, 406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned');
      return rep || req.method === 'GET' ? json(res, status, data) : json(res, status === 201 ? 201 : 204);
    };

    if (req.method === 'GET') return finish(200, applyQuery(scoped(table, w), q));
    if (w.anon) return err(res, 401, '42501', 'permission denied for table ' + table);

    if (req.method === 'POST') {
      const r = { id: uid(), user_id: w.id, created_at: iso(), ...body };
      if (table === 'pets') {
        if (!r.nombre || !String(r.nombre).trim()) return err(res, 400, '23514', 'check violation');
        r.especie = r.especie || 'Perro';
      } else if (table === 'bookings') {
        const p = state.professionals.find((x) => x.id === r.professional_id && x.activo);
        if (!p) return err(res, 400, 'P0001', 'PROFESIONAL_NO_DISPONIBLE');
        r.servicio = p.servicio === 'paseo' ? 'Paseo' : 'Baño y peluquería'; r.precio = p.precio; r.duracion_min = p.duracion_min; r.estado = 'confirmada';
        if (r.fecha < today()) return err(res, 400, 'P0001', 'FECHA_PASADA');
        if (state.bookings.filter((b) => b.user_id === w.id && b.estado === 'confirmada').length >= 5) return err(res, 400, 'P0001', 'LIMITE_RESERVAS');
        if (slotTaken(r)) return err(res, 409, '23505', 'duplicate key value violates unique constraint "bookings_slot_unico"');
        notify(w.id, 'Tu reserva ha sido confirmada.');
      } else return err(res, 403, '42501', 'permission denied');
      state[table].push(r);
      return finish(201, [r]);
    }
    if (req.method === 'PATCH' || req.method === 'DELETE') {
      const rows = applyQuery(scoped(table, w), q);
      if (req.method === 'DELETE') {
        if (table !== 'pets') return err(res, 403, '42501', 'permission denied');
        state[table] = state[table].filter((r) => !rows.includes(r));
        return finish(200, rows);
      }
      for (const r of rows) {
        const old = { ...r };
        if (table === 'bookings') {
          const nb = { ...r, ...body };
          if (old.estado === 'cancelada' && nb.estado !== 'cancelada') return err(res, 400, 'P0001', 'RESERVA_CANCELADA');
          if ((body.fecha || body.hora) && slotTaken(nb, r.id)) return err(res, 409, '23505', 'duplicate key value violates unique constraint "bookings_slot_unico"');
          for (const k of Object.keys(body)) if (['estado', 'fecha', 'hora'].includes(k)) r[k] = body[k];
          if (r.estado === 'cancelada' && old.estado === 'confirmada') notify(r.user_id, 'Tu reserva fue cancelada.');
          else if (r.fecha !== old.fecha || r.hora !== old.hora) notify(r.user_id, 'Tu reserva fue reprogramada.');
        } else if (table === 'profiles') {
          for (const k of ['nombre', 'telefono', 'ciudad']) if (k in body) r[k] = body[k];
        } else if (table === 'notifications') {
          if ('leida' in body) r.leida = body.leida;
        } else return err(res, 403, '42501', 'permission denied');
      }
      return finish(200, rows);
    }
    return err(res, 405, 'x', 'x');
  });

  return {
    state, addUser, KEY,
    listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))),
    close: () => new Promise((r) => server.close(r))
  };
}

module.exports = { create, KEY, today };
