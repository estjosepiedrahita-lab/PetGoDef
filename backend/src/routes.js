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

// ---- Validación de los datos de proveedores ----
function bizFields(b, create) {
  const out = {};
  if (create) {
    if (!['individual', 'empresa'].includes(b.tipo)) throw v.bad('"tipo" debe ser individual o empresa.');
    out.tipo = b.tipo;
    out.nombre = v.text(b, 'nombre', { required: true, max: 80 });
  } else {
    const n = v.text(b, 'nombre', { max: 80 }); if (n !== undefined) out.nombre = n;
  }
  const zona = v.text(b, 'zona', { max: 80 }); if (zona !== undefined) out.zona = zona;
  if ('descripcion' in b) out.descripcion = v.text(b, 'descripcion', { max: 350 }) || '';
  if (b.cantidad !== undefined) {
    const n = Number(b.cantidad);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw v.bad('"cantidad" debe ser un número entre 1 y 500.');
    out.cantidad = n;
  }
  if (create && out.tipo === 'empresa' && (out.cantidad === undefined || out.cantidad < 2)) throw v.bad('Una empresa debe indicar al menos dos personas.');
  if (create && out.tipo === 'individual') out.cantidad = 1;
  return out;
}

function workerFields(b, create) {
  const out = {};
  const nombre = v.text(b, 'nombre', { required: create, max: 80 }); if (nombre !== undefined) out.nombre = nombre;
  if ('funcion' in b) out.funcion = v.text(b, 'funcion', { max: 40 }) || 'Otro';
  if ('descripcion' in b) out.descripcion = v.text(b, 'descripcion', { max: 150 }) || '';
  return out;
}

function offerFields(b, create) {
  const out = {};
  if (create || b.servicio !== undefined) {
    if (!['paseo', 'bano'].includes(b.servicio)) throw v.bad('"servicio" debe ser paseo o bano.');
    out.servicio = b.servicio;
  }
  if (create || b.precio !== undefined) {
    const n = Number(b.precio);
    if (!Number.isInteger(n) || n < 1000 || n > 5000000) throw v.bad('"precio" debe ser un número entero entre 1.000 y 5.000.000.');
    out.precio = n;
  }
  if (create || b.duracion_min !== undefined) {
    const n = Number(b.duracion_min);
    if (!Number.isInteger(n) || n < 10 || n > 600) throw v.bad('"duracion_min" debe estar entre 10 y 600 minutos.');
    out.duracion_min = n;
  }
  const horario = v.text(b, 'horario', { required: create, max: 80 }); if (horario !== undefined) out.horario = horario;
  const desc = v.text(b, 'descripcion', { required: create, max: 350 }); if (desc !== undefined) out.descripcion = desc;
  if (b.disponible !== undefined) {
    if (typeof b.disponible !== 'boolean') throw v.bad('"disponible" debe ser verdadero o falso.');
    out.disponible = b.disponible;
  }
  return out;
}

async function myBusinessId(ctx) {
  const rows = await rest(ctx.cfg, ctx.token, { table: 'businesses', query: 'select=id' });
  if (!rows.length) throw new ApiError(409, 'sin_negocio', 'Primero crea tu perfil de negocio.');
  return rows[0].id;
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
    method: 'PATCH', path: '/api/pets/:id',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const b = body(ctx);
      v.pickKnown(b, ['nombre', 'especie', 'raza', 'edad', 'foto_path']);
      const patch = {};
      const nombre = v.text(b, 'nombre', { max: 60 }); if (nombre !== undefined) patch.nombre = nombre;
      if ('especie' in b) patch.especie = v.text(b, 'especie', { max: 30 }) || 'Perro';
      if ('raza' in b) patch.raza = v.text(b, 'raza', { max: 60 }) || null;
      if ('edad' in b) patch.edad = v.text(b, 'edad', { max: 30 }) || null;
      if ('foto_path' in b) {
        if (b.foto_path === null || b.foto_path === '') patch.foto_path = null;
        else {
          const fp = v.text(b, 'foto_path', { max: 200 });
          if (!new RegExp('^' + ctx.user.id + '/[A-Za-z0-9_-]{8,64}\\.jpg$').test(fp)) throw v.bad('La ruta de la foto no es válida.');
          patch.foto_path = fp;
        }
      }
      if (!Object.keys(patch).length) throw v.bad('No hay nada que actualizar.');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'pets', query: `${eq('id', id)}&select=*`, body: patch, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró la mascota.');
      return { body: rows[0] };
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

  // ---- Proveedores: negocio, equipo, ofertas y citas ----
  {
    method: 'GET', path: '/api/business',
    handler: async ({ cfg, token }) => {
      const rows = await rest(cfg, token, { table: 'businesses', query: 'select=*' });
      return { body: rows[0] || null };
    }
  },
  {
    method: 'POST', path: '/api/business',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['tipo', 'nombre', 'zona', 'descripcion', 'cantidad']);
      const row = bizFields(b, true);
      const rows = await rest(ctx.cfg, ctx.token, { method: 'POST', table: 'businesses', query: 'select=*', body: row, prefer: 'return=representation' });
      return { status: 201, body: rows[0] };
    }
  },
  {
    method: 'PATCH', path: '/api/business',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['nombre', 'zona', 'descripcion', 'cantidad']);
      const patch = bizFields(b, false);
      if (!Object.keys(patch).length) throw v.bad('No hay nada que actualizar.');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'businesses', query: 'select=*', body: patch, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'sin_negocio', 'Todavía no tienes un negocio creado.');
      return { body: rows[0] };
    }
  },
  {
    method: 'GET', path: '/api/business/workers',
    handler: async ({ cfg, token }) => ({ body: await rest(cfg, token, { table: 'workers', query: 'select=*&order=created_at.asc' }) })
  },
  {
    method: 'POST', path: '/api/business/workers',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['nombre', 'funcion', 'descripcion']);
      const row = Object.assign(workerFields(b, true), { business_id: await myBusinessId(ctx) });
      const rows = await rest(ctx.cfg, ctx.token, { method: 'POST', table: 'workers', query: 'select=*', body: row, prefer: 'return=representation' });
      return { status: 201, body: rows[0] };
    }
  },
  {
    method: 'PATCH', path: '/api/business/workers/:id',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const b = body(ctx);
      v.pickKnown(b, ['nombre', 'funcion', 'descripcion']);
      const patch = workerFields(b, false);
      if (!Object.keys(patch).length) throw v.bad('No hay nada que actualizar.');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'workers', query: `${eq('id', id)}&select=*`, body: patch, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró al trabajador.');
      return { body: rows[0] };
    }
  },
  {
    method: 'DELETE', path: '/api/business/workers/:id',
    handler: async (ctx) => {
      const id = v.uuid(ctx.params.id);
      const rows = await rest(ctx.cfg, ctx.token, { method: 'DELETE', table: 'workers', query: `${eq('id', id)}&select=id`, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró al trabajador.');
      return { body: { eliminado: id } };
    }
  },
  {
    method: 'GET', path: '/api/business/offers',
    handler: async ({ cfg, token }) => ({ body: await rest(cfg, token, { table: 'professionals', query: 'select=*&business_id=not.is.null&order=nombre.asc,servicio.asc' }) })
  },
  {
    method: 'POST', path: '/api/business/offers',
    handler: async (ctx) => {
      const b = body(ctx);
      v.pickKnown(b, ['servicio', 'precio', 'duracion_min', 'horario', 'descripcion', 'disponible']);
      const row = Object.assign(offerFields(b, true), { business_id: await myBusinessId(ctx) });
      const rows = await rest(ctx.cfg, ctx.token, { method: 'POST', table: 'professionals', query: 'select=*', body: row, prefer: 'return=representation' });
      return { status: 201, body: rows[0] };
    }
  },
  {
    method: 'PATCH', path: '/api/business/offers/:id',
    handler: async (ctx) => {
      const id = v.slug(ctx.params.id, 'id');
      const b = body(ctx);
      v.pickKnown(b, ['servicio', 'precio', 'duracion_min', 'horario', 'descripcion', 'disponible']);
      const patch = offerFields(b, false);
      if (!Object.keys(patch).length) throw v.bad('No hay nada que actualizar.');
      const rows = await rest(ctx.cfg, ctx.token, { method: 'PATCH', table: 'professionals', query: `${eq('id', id)}&business_id=not.is.null&select=*`, body: patch, prefer: 'return=representation' });
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró el servicio.');
      return { body: rows[0] };
    }
  },
  {
    method: 'DELETE', path: '/api/business/offers/:id',
    handler: async (ctx) => {
      const id = v.slug(ctx.params.id, 'id');
      let rows;
      try {
        rows = await rest(ctx.cfg, ctx.token, { method: 'DELETE', table: 'professionals', query: `${eq('id', id)}&business_id=not.is.null&select=id`, prefer: 'return=representation' });
      } catch (e) {
        if (e.code === 'referencia_invalida') throw new ApiError(409, 'oferta_con_reservas', 'Este servicio ya tiene reservas. Márcalo como "sin cupos" en lugar de eliminarlo.');
        throw e;
      }
      if (!rows.length) throw new ApiError(404, 'no_encontrado', 'No se encontró el servicio.');
      return { body: { eliminado: id } };
    }
  },
  {
    method: 'GET', path: '/api/business/bookings',
    handler: async ({ cfg, token }) => ({ body: (await rpc(cfg, token, 'provider_bookings', {})) || [] })
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
