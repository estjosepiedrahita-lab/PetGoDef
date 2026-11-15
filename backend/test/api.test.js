'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./mock-supabase');
const { createApp } = require('../src/http');
const { routes } = require('../src/routes');
const cfgMod = require('../src/config');

const ORIGIN = 'https://petgo.netlify.app';
let sup, supPort, app, base, ana, luis;

function nextDow(dow, from = 3) {
  for (let i = from; i < from + 8; i++) {
    const f = plusDays(i);
    if (new Date(f + 'T00:00:00Z').getUTCDay() === dow) return f;
  }
}
function plusDays(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
}

async function listen(server) { await new Promise((r) => server.listen(0, '127.0.0.1', r)); return server.address().port; }

function api(user) {
  return async (method, path, body, extra) => {
    const headers = Object.assign({}, user ? { Authorization: 'Bearer ' + user.token } : {}, body !== undefined ? { 'Content-Type': 'application/json' } : {}, extra || {});
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
}

test.before(async () => {
  sup = mock.create();
  supPort = await sup.listen();
  ana = sup.addUser('ana@x.co');
  luis = sup.addUser('luis@x.co');
  const cfg = cfgMod.load({ SUPABASE_URL: 'http://127.0.0.1:' + supPort, SUPABASE_KEY: mock.KEY, ALLOWED_ORIGINS: ORIGIN + ',http://localhost:5500', RATE_LIMIT_PER_MIN: '1000' });
  app = createApp(cfg, routes);
  base = 'http://127.0.0.1:' + (await listen(app));
});
test.after(async () => { app.close(); await sup.close(); });

test('salud: responde sin sesión', async () => {
  const r = await api()('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('seguridad: sin token o con token inválido da 401', async () => {
  assert.equal((await api()('GET', '/api/pets')).status, 401);
  const r = await api({ token: 'tok-falso' })('GET', '/api/pets');
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'sesion_invalida');
});

test('CORS: permite solo los orígenes configurados', async () => {
  const ok = await api(ana)('GET', '/api/pets', undefined, { Origin: ORIGIN });
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  const no = await api(ana)('GET', '/api/pets', undefined, { Origin: 'https://malo.example' });
  assert.equal(no.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(base + '/api/bookings', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
});

test('perfil: leer, actualizar y rechazar campos no permitidos', async () => {
  const a = api(ana);
  assert.equal((await a('GET', '/api/me')).body.correo, 'ana@x.co');
  const r = await a('PATCH', '/api/me', { nombre: '  Ana Gómez ', telefono: '300 111 2233' });
  assert.equal(r.status, 200);
  assert.equal(r.body.nombre, 'Ana Gómez');
  assert.equal((await a('PATCH', '/api/me', { correo: 'otro@x.co' })).status, 400);
  assert.equal((await a('PATCH', '/api/me', { nombre: 'x'.repeat(81) })).status, 400);
  assert.equal((await a('PATCH', '/api/me', {})).status, 400);
});

test('mascotas: crear, listar, aislar entre usuarios y eliminar', async () => {
  const a = api(ana), l = api(luis);
  const bad = await a('POST', '/api/pets', { nombre: '   ' });
  assert.equal(bad.status, 400);
  const c = await a('POST', '/api/pets', { nombre: 'Max', raza: 'Golden', edad: '3 años' });
  assert.equal(c.status, 201);
  assert.equal(c.body.especie, 'Perro');
  assert.equal((await a('GET', '/api/pets')).body.length, 1);
  assert.equal((await l('GET', '/api/pets')).body.length, 0, 'Luis no ve las mascotas de Ana');
  assert.equal((await l('DELETE', '/api/pets/' + c.body.id)).status, 404, 'Luis no puede borrar la mascota de Ana');
  assert.equal((await a('DELETE', '/api/pets/no-es-uuid')).status, 400);
  assert.equal((await a('POST', '/api/pets', { nombre: 'X', foto_path: '../../etc/passwd' })).status, 400);
  assert.equal((await a('POST', '/api/pets', { nombre: 'X', foto_path: `${luis.id}/abcdefgh12.jpg` })).status, 400, 'no se acepta foto de la carpeta de otro');
  assert.equal((await a('POST', '/api/pets', { nombre: 'X', user_id: luis.id })).status, 400, 'no se puede asignar otro dueño');
  const ok = await a('POST', '/api/pets', { nombre: 'Luna', foto_path: `${ana.id}/abcdefgh12.jpg` });
  assert.equal(ok.status, 201);
  const del = await a('DELETE', '/api/pets/' + ok.body.id);
  assert.equal(del.status, 200);
  assert.equal(del.body.foto_path, `${ana.id}/abcdefgh12.jpg`);
});

test('catálogo: público, filtrable y con errores claros', async () => {
  const all = await api()('GET', '/api/professionals');
  assert.equal(all.status, 200);
  assert.equal(all.body.length, 3);
  assert.equal((await api()('GET', '/api/professionals?servicio=bano')).body.length, 1);
  assert.equal((await api()('GET', '/api/professionals?servicio=otro')).status, 400);
  assert.equal((await api()('GET', '/api/professionals/happy-walk')).body.precio, 18000);
  assert.equal((await api()('GET', '/api/professionals/no-existe')).status, 404);
  assert.equal((await api()('GET', '/api/professionals/NO%20VALIDO!')).status, 400);
});

test('reservas: flujo completo con reglas de negocio', async () => {
  const a = api(ana), l = api(luis);
  const pet = (await a('POST', '/api/pets', { nombre: 'Rocky' })).body;
  const fecha = plusDays(10);

  // validaciones
  assert.equal((await a('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha, hora: '25:00' })).status, 400);
  assert.equal((await a('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha, hora: '23:00' })).status, 400);
  assert.equal((await a('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha: '2026-02-31', hora: '10:00' })).status, 400);
  assert.equal((await a('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha: plusDays(-2), hora: '10:00' })).body.error.code, 'fecha_pasada');
  assert.equal((await a('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha, hora: '10:00', precio: 1 })).status, 400, 'el precio no lo manda el cliente');
  assert.equal((await a('POST', '/api/bookings', { professional_id: 'no-existe', pet_id: pet.id, fecha, hora: '10:00' })).body.error.code, 'profesional_no_disponible');
  assert.equal((await l('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha, hora: '10:00' })).status, 404, 'no se reserva con la mascota de otro');

  // crear
  const c = await a('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: pet.id, fecha, hora: '15:00' });
  assert.equal(c.status, 201);
  assert.equal(c.body.precio, 18000);
  assert.equal(c.body.servicio, 'Paseo');
  assert.equal(c.body.pet_nombre, 'Rocky');
  assert.equal(c.body.professionals.nombre, 'Happy Walk');

  // disponibilidad y choque de horarios entre usuarios
  const av = await l('GET', `/api/availability?professional=happy-walk&fecha=${fecha}`);
  assert.deepEqual(av.body, ['15:00']);
  const lp = (await l('POST', '/api/pets', { nombre: 'Toby' })).body;
  const dup = await l('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: lp.id, fecha, hora: '15:00' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'horario_ocupado');

  // Luis no ve ni toca la reserva de Ana
  assert.equal((await l('GET', '/api/bookings')).body.length, 0);
  assert.equal((await l('POST', `/api/bookings/${c.body.id}/cancel`)).status, 404);
  assert.equal((await l('PATCH', `/api/bookings/${c.body.id}`, { hora: '10:00' })).status, 404);

  // reprogramar
  const rp = await a('PATCH', `/api/bookings/${c.body.id}`, { hora: '17:00' });
  assert.equal(rp.status, 200);
  assert.equal(rp.body.hora, '17:00');
  assert.equal((await a('PATCH', `/api/bookings/${c.body.id}`, { estado: 'cancelada' })).status, 400, 'no se cambia el estado por PATCH');
  // el horario liberado ya se puede reservar
  assert.equal((await l('POST', '/api/bookings', { professional_id: 'happy-walk', pet_id: lp.id, fecha, hora: '15:00' })).status, 201);

  // cancelar (idempotente) y no reprogramar canceladas
  const cn = await a('POST', `/api/bookings/${c.body.id}/cancel`);
  assert.equal(cn.body.estado, 'cancelada');
  assert.equal((await a('POST', `/api/bookings/${c.body.id}/cancel`)).status, 200);
  assert.equal((await a('PATCH', `/api/bookings/${c.body.id}`, { hora: '10:00' })).body.error.code, 'reserva_cancelada');

  // notificaciones generadas
  const ns = (await a('GET', '/api/notifications')).body.map((n) => n.texto);
  assert.ok(ns.includes('Tu reserva ha sido confirmada.'));
  assert.ok(ns.includes('Tu reserva fue cancelada.'));
});

test('reservas: límite de 5 pendientes', async () => {
  const u = sup.addUser('limite@x.co'), a = api(u);
  const pet = (await a('POST', '/api/pets', { nombre: 'Firulais' })).body;
  for (const h of ['07:00', '08:00', '09:00', '10:00', '11:00']) {
    assert.equal((await a('POST', '/api/bookings', { professional_id: 'paseos-petgo', pet_id: pet.id, fecha: plusDays(20), hora: h })).status, 201);
  }
  const r = await a('POST', '/api/bookings', { professional_id: 'paseos-petgo', pet_id: pet.id, fecha: plusDays(20), hora: '12:00' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'limite_reservas');
});

test('notificaciones: marcar una y todas como leídas', async () => {
  const u = sup.addUser('notis@x.co'), a = api(u);
  const pet = (await a('POST', '/api/pets', { nombre: 'Kira' })).body;
  for (const h of ['07:00', '08:00']) await a('POST', '/api/bookings', { professional_id: 'petgo-grooming', pet_id: pet.id, fecha: plusDays(15), hora: h });
  let ns = (await a('GET', '/api/notifications')).body;
  assert.equal(ns.length, 2);
  assert.equal((await a('PATCH', '/api/notifications/' + ns[0].id, { leida: false })).status, 400);
  assert.equal((await a('PATCH', '/api/notifications/' + ns[0].id, { leida: true })).body.leida, true);
  assert.equal((await api(luis)('PATCH', '/api/notifications/' + ns[1].id, { leida: true })).status, 404, 'no se tocan notificaciones ajenas');
  const all = await a('POST', '/api/notifications/read-all');
  assert.equal(all.body.actualizadas, 1);
  ns = (await a('GET', '/api/notifications')).body;
  assert.ok(ns.every((n) => n.leida));
});

test('protocolo: rutas, métodos, JSON y tamaño', async () => {
  const a = api(ana);
  assert.equal((await a('GET', '/api/nada')).status, 404);
  assert.equal((await a('DELETE', '/api/me')).status, 405);
  assert.equal((await a('PATCH', '/api/me', '{no es json')).status, 400);
  assert.equal((await a('PATCH', '/api/me', JSON.stringify({ nombre: 'x'.repeat(70000) }))).status, 413);
  const r = await fetch(base + '/api/me', { method: 'PATCH', headers: { Authorization: 'Bearer ' + ana.token, 'Content-Type': 'text/plain' }, body: '{"nombre":"A"}' });
  assert.equal(r.status, 415);
  assert.equal((await a('POST', '/api/pets', [1, 2])).status, 400);
});

test('límite de peticiones: responde 429 al excederse', async () => {
  const cfg = cfgMod.load({ SUPABASE_URL: 'http://127.0.0.1:' + supPort, SUPABASE_KEY: mock.KEY, RATE_LIMIT_PER_MIN: '3', TRUST_PROXY: 'false' });
  const s = createApp(cfg, routes);
  const p = await listen(s);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await fetch(`http://127.0.0.1:${p}/api/health`)).status);
  s.close();
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
});

test('config: rechaza claves secretas y variables faltantes', () => {
  assert.throws(() => cfgMod.validate(cfgMod.load({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_KEY: 'sb_secret_abc' })), /clave secreta/);
  assert.deepEqual(cfgMod.validate(cfgMod.load({})), ['SUPABASE_URL', 'SUPABASE_KEY']);
  assert.equal(cfgMod.load({ SUPABASE_URL: 'https://a.supabase.co/rest/v1/' }).supabaseUrl, 'https://a.supabase.co');
});

test('base de datos caída: la API responde 502 sin filtrar detalles', async () => {
  const cfg = cfgMod.load({ SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_KEY: mock.KEY });
  const s = createApp(cfg, routes);
  const p = await listen(s);
  const r = await fetch(`http://127.0.0.1:${p}/api/pets`, { headers: { Authorization: 'Bearer tok-x' } });
  s.close();
  assert.equal(r.status, 502);
});

// ---------------- Proveedores ----------------
test('proveedores: crear negocio, equipo y ofertas; aparecen en el catálogo y se pueden reservar', async () => {
  const pro = sup.addUser('paseos@x.co');
  const P = api(pro), A = api(ana);
  assert.equal((await P('GET', '/api/business')).body, null);
  assert.equal((await P('POST', '/api/business/offers', { servicio: 'paseo', precio: 20000, duracion_min: 30, dias: [1, 2, 3, 4, 5, 6], hora_inicio: '08:00', hora_fin: '18:00', descripcion: 'x' })).body.error.code, 'sin_negocio');
  assert.equal((await P('POST', '/api/business', { tipo: 'empresa', nombre: 'Solo uno', cantidad: 1, direccion: 'x' })).status, 400);
  const b = await P('POST', '/api/business', { tipo: 'empresa', nombre: 'Paseos Luna', zona: 'Chapinero', cantidad: 3, direccion: 'Cra 7 # 45-10', telefono: '+57 300 123 4567' });
  assert.equal(b.status, 201);
  assert.equal((await P('POST', '/api/business', { tipo: 'individual', nombre: 'Otro' })).status, 409);

  const w = await P('POST', '/api/business/workers', { nombre: 'Carlos', funcion: 'Paseador' });
  assert.equal(w.status, 201);
  assert.equal((await P('PATCH', '/api/business/workers/' + w.body.id, { descripcion: 'Turno mañana' })).body.descripcion, 'Turno mañana');
  assert.equal((await P('GET', '/api/business/workers')).body.length, 1);
  assert.equal((await api(luis)('GET', '/api/business/workers')).body.length, 0);

  assert.equal((await P('POST', '/api/business/offers', { servicio: 'paseo', precio: 5, duracion_min: 30, dias: [1, 2, 3, 4, 5, 6], hora_inicio: '08:00', hora_fin: '18:00', descripcion: 'x' })).status, 400);
  assert.equal((await P('POST', '/api/business/offers', { servicio: 'paseo', precio: 20000, duracion_min: 30, dias: [1, 2, 3, 4, 5, 6], hora_inicio: '08:00', hora_fin: '18:00', descripcion: 'x', rating: 5 })).status, 400);
  const o = await P('POST', '/api/business/offers', { servicio: 'paseo', precio: 21000, duracion_min: 40, dias: [1, 2, 3, 4, 5, 6], hora_inicio: '08:00', hora_fin: '18:00', descripcion: 'Paseos con cariño' });
  assert.equal(o.status, 201);
  assert.equal(o.body.nombre, 'Paseos Luna');
  assert.equal(o.body.direccion, 'Cra 7 # 45-10');
  assert.equal(o.body.telefono, '+57 300 123 4567');
  assert.equal(o.body.horario, 'Lun–Sáb, 8:00 AM – 6:00 PM');
  assert.equal(o.body.rating, 0);

  const cat = await api()('GET', '/api/professionals?servicio=paseo');
  assert.ok(cat.body.some((x) => x.id === o.body.id));

  // un dueño reserva la oferta y el proveedor ve la cita con el nombre del cliente
  const mascota = (await A('POST', '/api/pets', { nombre: 'Rocky' })).body;
  const fecha = nextDow(1);   // un lunes
  const bk = await A('POST', '/api/bookings', { professional_id: o.body.id, pet_id: mascota.id, fecha, hora: '10:00' });
  assert.equal(bk.status, 201);
  const citas = await P('GET', '/api/business/bookings');
  assert.equal(citas.body.length, 1);
  assert.equal(citas.body[0].pet_nombre, 'Rocky');
  assert.ok(citas.body[0].cliente && citas.body[0].cliente !== 'Cliente');
  assert.equal((await api(luis)('GET', '/api/business/bookings')).body.length, 0);

  // sin cupos: no se puede reservar
  assert.equal((await P('PATCH', '/api/business/offers/' + o.body.id, { disponible: false })).body.disponible, false);
  const bk2 = await A('POST', '/api/bookings', { professional_id: o.body.id, pet_id: mascota.id, fecha, hora: '11:00' });
  assert.equal(bk2.status, 404);
  // con reservas no se elimina
  assert.equal((await P('DELETE', '/api/business/offers/' + o.body.id)).body.error.code, 'oferta_con_reservas');

  // otro usuario no puede tocar ofertas ajenas ni las del catálogo base
  assert.equal((await api(luis)('PATCH', '/api/business/offers/' + o.body.id, { precio: 1000 })).status, 404);
  assert.equal((await P('PATCH', '/api/business/offers/happy-walk', { precio: 1000 })).status, 404);
  assert.equal((await P('DELETE', '/api/business/offers/happy-walk')).status, 404);

  // al renombrar el negocio, cambia en sus ofertas
  await P('PATCH', '/api/business', { nombre: 'Luna Pet' });
  assert.equal((await api()('GET', '/api/professionals/' + o.body.id)).body.nombre, 'Luna Pet');
  assert.equal((await P('DELETE', '/api/business/workers/' + w.body.id)).status, 200);
});

test('mascotas: editar nombre, raza y foto', async () => {
  const A = api(ana);
  const m = (await A('POST', '/api/pets', { nombre: 'Toby', raza: 'Criollo' })).body;
  const e = await A('PATCH', '/api/pets/' + m.id, { nombre: 'Toby II', edad: '4' });
  assert.equal(e.status, 200);
  assert.equal(e.body.nombre, 'Toby II');
  assert.equal(e.body.raza, 'Criollo');
  assert.equal((await A('PATCH', '/api/pets/' + m.id, { foto_path: luis.id + '/abcdefgh12.jpg' })).status, 400);
  assert.equal((await A('PATCH', '/api/pets/' + m.id, { foto_path: ana.id + '/abcdefgh12.jpg' })).status, 200);
  assert.equal((await A('PATCH', '/api/pets/' + m.id, {})).status, 400);
  assert.equal((await api(luis)('PATCH', '/api/pets/' + m.id, { nombre: 'Robado' })).status, 404);
});

// ---------------- Perfil, horarios, dirección ----------------
test('negocio: se puede editar (la actualización va con filtro por id) y guarda dirección, teléfono y foto', async () => {
  const u = sup.addUser('editar@x.co'), P = api(u);
  await P('POST', '/api/business', { tipo: 'individual', nombre: 'Ana Paseos' });
  const r = await P('PATCH', '/api/business', { nombre: 'Ana Paseos Bogotá', zona: 'Suba', descripcion: 'Hola', telefono: '3001234567', direccion: 'Calle 1 # 2-3', foto_path: u.id + '/abcdefgh12.jpg' });
  assert.equal(r.status, 200);
  assert.equal(r.body.nombre, 'Ana Paseos Bogotá');
  assert.equal(r.body.telefono, '3001234567');
  assert.equal(r.body.foto_path, u.id + '/abcdefgh12.jpg');
  assert.equal((await P('PATCH', '/api/business', { telefono: 'abc' })).status, 400);
  assert.equal((await P('PATCH', '/api/business', { foto_path: 'otro/abcdefgh12.jpg' })).status, 400);
  assert.equal((await api(sup.addUser('sin@x.co'))('PATCH', '/api/business', { nombre: 'X' })).body.error.code, 'sin_negocio');
});

test('empresas y baños requieren dirección; horario validado', async () => {
  const u = sup.addUser('banos@x.co'), P = api(u);
  assert.equal((await P('POST', '/api/business', { tipo: 'empresa', nombre: 'Sin dirección', cantidad: 2 })).status, 400);
  await P('POST', '/api/business', { tipo: 'individual', nombre: 'Peluquero' });
  const base = { servicio: 'bano', precio: 30000, duracion_min: 60, dias: [2, 4], hora_inicio: '09:00', hora_fin: '17:00', descripcion: 'Baños' };
  assert.equal((await P('POST', '/api/business/offers', base)).body.error.code, 'direccion_requerida');
  await P('PATCH', '/api/business', { direccion: 'Cll 10 # 5-5' });
  assert.equal((await P('POST', '/api/business/offers', { ...base, dias: [] })).status, 400);
  assert.equal((await P('POST', '/api/business/offers', { ...base, dias: [7] })).status, 400);
  assert.equal((await P('POST', '/api/business/offers', { ...base, hora_inicio: '06:00' })).status, 400);
  assert.equal((await P('POST', '/api/business/offers', { ...base, hora_inicio: '18:00', hora_fin: '17:00' })).status, 400);
  assert.equal((await P('POST', '/api/business/offers', { ...base, hora_inicio: '16:30', duracion_min: 60 })).status, 400);
  const ok = await P('POST', '/api/business/offers', base);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.horario, 'Mar, Jue, 9:00 AM – 5:00 PM');
  assert.equal(ok.body.direccion, 'Cll 10 # 5-5');
});

test('reservas: se respeta el horario del proveedor', async () => {
  const u = sup.addUser('horario@x.co'), P = api(u), A = api(ana);
  await P('POST', '/api/business', { tipo: 'individual', nombre: 'Horario Test' });
  const o = (await P('POST', '/api/business/offers', { servicio: 'paseo', precio: 15000, duracion_min: 60, dias: [1, 3], hora_inicio: '09:00', hora_fin: '12:00', descripcion: 'x' })).body;
  const mon = nextDow(1), tue = nextDow(2);
  const pet = (await A('GET', '/api/pets')).body[0] || (await A('POST', '/api/pets', { nombre: 'Tmp' })).body;
  const book = (fecha, hora) => A('POST', '/api/bookings', { professional_id: o.id, pet_id: pet.id, fecha, hora });
  assert.equal((await book(tue, '10:00')).body.error.code, 'fuera_de_horario');       // día no laborable
  assert.equal((await book(mon, '08:00')).body.error.code, 'fuera_de_horario');       // antes de abrir
  assert.equal((await book(mon, '11:30')).body.error.code, 'fuera_de_horario');       // la sesión terminaría después de cerrar
  const ok = await book(mon, '11:00');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.professionals.direccion, '');
  // reprogramar también respeta el horario
  assert.equal((await A('PATCH', '/api/bookings/' + ok.body.id, { fecha: tue })).body.error.code, 'fuera_de_horario');
  assert.equal((await A('PATCH', '/api/bookings/' + ok.body.id, { hora: '09:00' })).status, 200);
  await A('POST', '/api/bookings/' + ok.body.id + '/cancel');
});

test('catálogo: el equipo de un negocio es público y las mascotas guardan descripción', async () => {
  const u = sup.addUser('equipo@x.co'), P = api(u), A = api(ana);
  await P('POST', '/api/business', { tipo: 'empresa', nombre: 'Equipo SAS', cantidad: 2, direccion: 'Av 1' });
  const w = await P('POST', '/api/business/workers', { nombre: 'Marta', funcion: 'Bañador', foto_path: u.id + '/fotoequipo1.jpg' });
  assert.equal(w.status, 201);
  const o = (await P('POST', '/api/business/offers', { servicio: 'bano', precio: 30000, duracion_min: 60, dias: [1], hora_inicio: '08:00', hora_fin: '12:00', descripcion: 'x' })).body;
  const pub = await api()('GET', '/api/professionals/' + o.id + '/workers');
  assert.equal(pub.status, 200);
  assert.equal(pub.body[0].nombre, 'Marta');
  assert.equal((await api()('GET', '/api/professionals/nada-nada/workers')).status, 404);
  const m = await A('POST', '/api/pets', { nombre: 'Dulce', descripcion: 'Muy juguetona, le tiene miedo a los truenos' });
  assert.equal(m.body.descripcion, 'Muy juguetona, le tiene miedo a los truenos');
  assert.equal((await A('PATCH', '/api/pets/' + m.body.id, { descripcion: 'x'.repeat(501) })).status, 400);
  assert.equal((await A('PATCH', '/api/me', { foto_path: ana.id + '/perfilana12.jpg' })).body.foto_path, ana.id + '/perfilana12.jpg');
});
