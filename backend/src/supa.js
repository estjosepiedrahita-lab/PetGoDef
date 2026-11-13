'use strict';
// Cliente mínimo de Supabase (Auth + PostgREST) usando fetch.
// Cada petición lleva el token del usuario: la base de datos aplica sus reglas RLS.
const { ApiError } = require('./errors');

function headers(cfg, token, extra) {
  return Object.assign({
    apikey: cfg.supabaseKey,
    Authorization: 'Bearer ' + (token || cfg.supabaseKey),
    'Content-Type': 'application/json'
  }, extra || {});
}

async function doFetch(cfg, url, init) {
  try {
    return await fetch(url, Object.assign({ signal: AbortSignal.timeout(cfg.requestTimeoutMs) }, init));
  } catch (e) {
    console.error('[supabase] sin respuesta:', e.name, e.message);
    throw new ApiError(502, 'base_de_datos_no_disponible', 'No se pudo comunicar con la base de datos.');
  }
}

// Comprueba el token con Supabase Auth y devuelve el usuario
async function getUser(cfg, token) {
  const res = await doFetch(cfg, cfg.supabaseUrl + '/auth/v1/user', { headers: headers(cfg, token) });
  if (res.status === 401 || res.status === 403) throw new ApiError(401, 'sesion_invalida', 'Tu sesión no es válida o expiró. Inicia sesión de nuevo.');
  if (!res.ok) throw new ApiError(502, 'auth_no_disponible', 'No se pudo verificar tu sesión.');
  const u = await res.json();
  if (!u || !u.id) throw new ApiError(401, 'sesion_invalida', 'Tu sesión no es válida.');
  return u;
}

// Traduce errores de PostgreSQL/PostgREST a errores de la API
function mapDbError(status, err) {
  const msg = String((err && (err.message || '')) + ' ' + ((err && err.details) || ''));
  const code = err && err.code;
  if (code === '23505' || /duplicate key|bookings_slot_unico/i.test(msg)) return new ApiError(409, 'horario_ocupado', 'Ese horario ya no está disponible.');
  if (/LIMITE_RESERVAS/.test(msg)) return new ApiError(409, 'limite_reservas', 'Alcanzaste el límite de 5 reservas pendientes.');
  if (/FECHA_PASADA/.test(msg)) return new ApiError(422, 'fecha_pasada', 'Esa fecha ya pasó. Elige otra.');
  if (/PROFESIONAL_NO_DISPONIBLE/.test(msg)) return new ApiError(404, 'profesional_no_disponible', 'Ese profesional no está disponible.');
  if (/RESERVA_CANCELADA/.test(msg)) return new ApiError(409, 'reserva_cancelada', 'Esa reserva ya está cancelada.');
  if (code === 'PGRST116') return new ApiError(404, 'no_encontrado', 'No se encontró el recurso.');
  if (code === '23503') return new ApiError(422, 'referencia_invalida', 'Hay una referencia que no existe.');
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return new ApiError(400, 'datos_invalidos', 'Los datos enviados no son válidos.');
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303') return new ApiError(401, 'sesion_invalida', 'Tu sesión no es válida o expiró.');
  if (status === 403 || code === '42501') return new ApiError(403, 'sin_permiso', 'No tienes permiso para esta acción.');
  console.error('[supabase] error inesperado:', status, JSON.stringify(err));
  return new ApiError(500, 'error_base_de_datos', 'Ocurrió un error al acceder a los datos.');
}

async function parse(res) {
  const t = await res.text();
  if (!t) return null;
  try { return JSON.parse(t); } catch { return t; }
}

// opts: { method, table, query, body, prefer, single }
async function rest(cfg, token, opts) {
  const q = opts.query ? '?' + opts.query : '';
  const prefer = opts.prefer ? { Prefer: opts.prefer } : {};
  const accept = opts.single ? { Accept: 'application/vnd.pgrst.object+json' } : {};
  const res = await doFetch(cfg, `${cfg.supabaseUrl}/rest/v1/${opts.table}${q}`, {
    method: opts.method || 'GET',
    headers: headers(cfg, token, Object.assign({}, prefer, accept)),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const data = await parse(res);
  if (!res.ok) throw mapDbError(res.status, data);
  return data;
}

async function rpc(cfg, token, fn, args) {
  const res = await doFetch(cfg, `${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: headers(cfg, token), body: JSON.stringify(args || {})
  });
  const data = await parse(res);
  if (!res.ok) throw mapDbError(res.status, data);
  return data;
}

module.exports = { getUser, rest, rpc, mapDbError };
