'use strict';
// Endpoints de la API de PetGo.
const { rest, rpc } = require('./supa');
const { ApiError } = require('./errors');
const v = require('./validate');

const BOOKING_SELECT = 'select=*,professionals(nombre)';

function eq(col, val) { return `${col}=eq.${encodeURIComponent(val)}`; }

function body(ctx) {
  if (!v.isObject(ctx.body)) throw v.bad('El cuerpo debe ser un objeto JSON.');
  return ctx.body;
}

const routes = [
  // ---- Salud ----
  { method: 'GET', path: '/api/health', auth: 'none', handler: async () => ({ body: { ok: true, servicio: 'petgo-api' } }) },

  // ---- Perfil ----
  {
    method: 'GET', path: '/api/me',
    handler: async ({ cfg, token, user }) => {
      const rows = await rest(cfg, token, { table: 'profiles', query: `select=*&${eq('id', user.id)}` });
      return { body: rows[0] || null };
    }
  },
  {
    method: 'PATCH', path: '/api/me',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['nombre', 'telefono', 'ciudad']);
      const patch = {};
      const nombre = v.text(b, 'nombre', { max: 80 }); if (nombre !== undefined) patch.nombre = nombre;
      if ('telefono' in b) patch.telefono = v.text(b, 'telefono', { max: 30 }) || '';
      const ciudad = v.text(b, 'ciudad', { max: 60 }); if (ciudad !== undefined) patch.ciudad = ciudad;
      if (!Object.keys(patch).length) throw v.bad('No hay nada que actualizar.');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'profiles', query: `${eq('id', ctx.user.id)}&select=*`, body: patch, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró tu perfil.');
      return { body: rows[0] };
    }
  },

  // ---- Mascotas ----
  {
    method: 'GET', path: '/api/pets',
    handler: async ({ cfg, token }) => ({ body: await rest(cfg, token, { table: 'pets', query: 'select=*&order=created_at.asc' }) })
  },
  {
    method: 'POST', path: '/api/pets',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['nombre', 'especie', 'raza', 'edad', 'foto_path']);
      const row = {
        nombre: v.text(b, 'nombre', { required: true, max: 60 }),
        especie: v.text(b, 'especie', { max: 30 }) || 'Perro',
        raza: v.text(b, 'raza', { max: 60 }) || null,
        edad: v.text(b, 'edad', { max: 30 }) || null,
        foto_path: null
      };
      if (b.foto_path) {
        const fp = v.text(b, 'foto_path', { max: 200 });
        // la foto debe estar en la carpeta del propio usuario: <id>/<archivo>.jpg
        if (!new RegExp('^' + ctx.user.id + '/[A-Za-z0-9_-]{8,64}\\.jpg$').test(fp)) throw v.bad('La ruta de la foto no es válida.');
        row.foto_path = fp;
      }
      const rows = await rest(ctx.cfg, ctx.token, { method: 'POST', table: 'pets', query: 'select=*', body: row, prefer: 'return=representation' });
      return { status: 201, body: rows[0] };
    }
  },
  {
    method: 'DELETE', path: '/api/pets/:id',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const rows = await rest(ctx.cfg, ctx.token, { method: 'DELETE', table: 'pets', query: `${eq('id', id)}&select=id,foto_path`, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró la mascota.');
      return { status: 200, body: { eliminada: id, foto_path: rows[0].foto_path || null } };
    }
  },

  // ---- Catálogo (público) ----
  {
    method: 'GET', path: '/api/professionals', auth: 'optional',
    handler: async ({ cfg, token, query }) => {
      let q = 'select=*&order=nombre.asc';
      if (query.servicio !== undefined) {
        if (!['paseo', 'bano'].includes(query.servicio)) throw v.bad('"servicio" debe ser paseo o bano.');
        q += '&' + eq('servicio', query.servicio);
      }
      return { body: await rest(cfg, token, { table: 'professionals', query: q }) };
    }
  },
  {
    method: 'GET', path: '/api/professionals/:id', auth: 'optional',
    handler: async ({ cfg, token, params }) => {
      const id = v.slug(params.id, 'id');
      const rows = await rest(cfg, token, { table: 'professionals', query: `select=*&${eq('id', id)}` });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró el profesional.');
      return { body: rows[0] };
    }
  },
  {
    method: 'GET', path: '/api/availability',
    handler: async ({ cfg, token, query }) => {
      const prof = v.slug(query.professional, 'professional');
      const fecha = v.fecha(query.fecha);
      const horas = await rpc(cfg, token, 'slots_ocupados', { p_professional: prof, p_fecha: fecha });
      return { body: (horas || []).map((h) => String(h).slice(0, 5)) };
    }
  },

  // ---- Reservas ----
  {
    method: 'GET', path: '/api/bookings',
    handler: async ({ cfg, token }) => ({ body: await rest(cfg, token, { table: 'bookings', query: BOOKING_SELECT + '&order=fecha.asc,hora.asc' }) })
  },
  {
    method: 'POST', path: '/api/bookings',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['professional_id', 'pet_id', 'pet_nombre', 'fecha', 'hora']);
      const professional_id = v.slug(b.professional_id, 'professional_id');
      const fecha = v.fechaNoPasada(v.fecha(b.fecha));
      const hora = v.hora(b.hora);
      let pet_id = null, pet_nombre;
      if (b.pet_id) {
        pet_id = v.uuid(b.pet_id, 'pet_id');
        const pets = await rest(ctx.cfg, ctx.token, { table: 'pets', query: `select=nombre&${eq('id', pet_id)}` });
        if (!pets.length) throw new ApiError(404, 'mascota_no_encontrada', 'No se encontró esa mascota.');
        pet_nombre = pets[0].nombre;                     // el nombre sale de la base, no del cliente
      } else {
        pet_nombre = v.text(b, 'pet_nombre', { required: true, max: 60 });
      }
      // precio, duración y servicio los fija la base de datos desde el catálogo
      const rows = await rest(ctx.cfg, ctx.token, {
        method: 'POST', table: 'bookings', query: BOOKING_SELECT,
        body: { professional_id, pet_id, pet_nombre, fecha, hora }, prefer: 'return=representation'
      });
      return { status: 201, body: rows[0] };
    }
  },
  {
    method: 'PATCH', path: '/api/bookings/:id',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const b = body(ctx);
      v.pickKnown(b, ['fecha', 'hora']);
      const patch = {};
      if (b.fecha !== undefined) patch.fecha = v.fechaNoPasada(v.fecha(b.fecha));
      if (b.hora !== undefined) patch.hora = v.hora(b.hora);
      if (!Object.keys(patch).length) throw v.bad('Indica la nueva fecha u hora.');
      const cur = await rest(ctx.cfg, ctx.token, { table: 'bookings', query: `select=id,estado&${eq('id', id)}` });
      if (!cur.length) throw new ApiError(404, 'no_encontrado', 'No se encontró la reserva.');
      if (cur[0].estado !== 'confirmada') throw new ApiError(409, 'reserva_cancelada', 'Esa reserva ya está cancelada.');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'bookings', query: `${eq('id', id)}&${BOOKING_SELECT}`, body: patch, prefer: 'return=representation' });
      return { body: rows[0] };
    }
  },
  {
    method: 'POST', path: '/api/bookings/:id/cancel',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const cur = await rest(ctx.cfg, ctx.token, { table: 'bookings', query: `${BOOKING_SELECT}&${eq('id', id)}` });
      if (!cur.length) throw new ApiError(404, 'no_encontrado', 'No se encontró la reserva.');
      if (cur[0].estado === 'cancelada') return { body: cur[0] };      // cancelar dos veces no da error
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'bookings', query: `${eq('id', id)}&${BOOKING_SELECT}`, body: { estado: 'cancelada' }, prefer: 'return=representation' });
      return { body: rows[0] };
    }
  },

  // ---- Notificaciones ----
  {
    method: 'GET', path: '/api/notifications',
    handler: async ({ cfg, token }) => ({ body: await rest(cfg, token, { table: 'notifications', query: 'select=*&order=created_at.desc&limit=100' }) })
  },
  {
    method: 'POST', path: '/api/notifications/read-all',
    handler: async ({ cfg, token }) => {
      const rows = await rest(cfg, token, { method: 'PATCH', table: 'notifications', query: 'leida=eq.false&select=id', body: { leida: true }, prefer: 'return=representation' });
      return { body: { actualizadas: rows.length } };
    }
  },
  {
    method: 'PATCH', path: '/api/notifications/:id',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const b = body(ctx);
      v.pickKnown(b, ['leida']);
      if (b.leida !== true) throw v.bad('Solo se puede marcar como leída ("leida": true).');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'notifications', query: `${eq('id', id)}&select=*`, body: { leida: true }, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró la notificación.');
      return { body: rows[0] };
    }
  }
];

module.exports = { routes };
