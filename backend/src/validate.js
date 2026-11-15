'use strict';
const { ApiError } = require('./errors');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function bad(msg) { return new ApiError(400, 'datos_invalidos', msg); }

function isObject(b) { return b && typeof b === 'object' && !Array.isArray(b); }

function text(body, key, { required = false, max = 100, min = 1 } = {}) {
  let v = body[key];
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`El campo "${key}" es obligatorio.`);
    return undefined;
  }
  if (typeof v !== 'string') throw bad(`El campo "${key}" debe ser texto.`);
  v = v.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (v.length < min && required) throw bad(`El campo "${key}" es obligatorio.`);
  if (v.length > max) throw bad(`El campo "${key}" admite máximo ${max} caracteres.`);
  return v;
}

function uuid(v, name = 'id') {
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`"${name}" no es un identificador válido.`);
  return v.toLowerCase();
}

function slug(v, name = 'profesional') {
  if (typeof v !== 'string' || !SLUG.test(v) || v.length > 60) throw bad(`"${name}" no es válido.`);
  return v;
}

// Fecha YYYY-MM-DD real (rechaza 2026-02-31)
function fecha(v, name = 'fecha') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad(`"${name}" debe tener el formato AAAA-MM-DD.`);
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw bad(`"${name}" no es una fecha real.`);
  return v;
}

function fechaNoPasada(v) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  if (v < hoy) throw new ApiError(422, 'fecha_pasada', 'Esa fecha ya pasó. Elige otra.');
  return v;
}

// Hora HH:MM entre 07:00 y 19:00
function hora(v, name = 'hora') {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(v)) throw bad(`"${name}" debe tener el formato HH:MM.`);
  const hm = v.slice(0, 5);
  if (hm < '07:00' || hm > '19:00') throw bad('El horario debe estar entre las 07:00 y las 19:00.');
  return hm;
}

// Ruta de foto dentro de la carpeta del propio usuario: <id>/<archivo>.jpg (null o '' = quitar)
function fotoPath(body, key, userId) {
  const val = body[key];
  if (val === null || val === '') return null;
  const fp = text(body, key, { max: 200 });
  if (!new RegExp('^' + userId + '/[A-Za-z0-9_-]{8,64}\\.jpg$').test(fp)) throw bad('La ruta de la foto no es válida.');
  return fp;
}

function telefono(body, key = 'telefono') {
  if (body[key] === undefined) return undefined;
  const t = text(body, key, { max: 30 }) || '';
  if (t && !/^[0-9+()\s-]{7,20}$/.test(t)) throw bad('El teléfono solo puede tener números, espacios, + ( ) y guiones (7 a 20 caracteres).');
  return t;
}

function horaHM(v, name = 'hora') {
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(v)) throw bad(`"${name}" debe tener el formato HH:MM.`);
  return v.slice(0, 5);
}

function pickKnown(body, allowed) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw bad(`Campos no permitidos: ${extra.join(', ')}.`);
}

module.exports = { horaHM, fotoPath, telefono, isObject, text, uuid, slug, fecha, fechaNoPasada, hora, pickKnown, bad, UUID };
