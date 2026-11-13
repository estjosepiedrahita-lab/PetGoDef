'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mock = require('./mock-supabase');
const { createApp } = require('../src/http');
const { routes } = require('../src/routes');
const cfgMod = require('../src/config');

const ORIGIN = 'https://petgo.netlify.app';
let sup, supPort, app, base, ana, luis;

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
