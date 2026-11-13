'use strict';
// Mini servidor HTTP: rutas, JSON, CORS, límite de peticiones y cabeceras de seguridad.
const http = require('http');
const { ApiError } = require('./errors');
const supa = require('./supa');

function compile(pattern) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys };
}

function createApp(cfg, routeDefs) {
  const routes = routeDefs.map((r) => Object.assign({}, r, compile(r.path)));
  const hits = new Map();           // ip -> { n, reset }

  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000).unref();

  function clientIp(req) {
    if (cfg.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      if (xf) return String(xf).split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'desconocida';
  }

  function limited(ip) {
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; hits.set(ip, h); }
    h.n++;
    return h.n > cfg.rateLimitPerMin ? Math.ceil((h.reset - now) / 1000) : 0;
  }

  function corsHeaders(req) {
    const origin = req.headers.origin;
    const h = { Vary: 'Origin' };
    if (origin && (cfg.allowedOrigins.includes('*') || cfg.allowedOrigins.includes(origin.replace(/\/+$/, '')))) {
      h['Access-Control-Allow-Origin'] = origin;
      h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      h['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
      h['Access-Control-Max-Age'] = '600';
    }
    return h;
  }

  function send(req, res, status, body, extra) {
    const payload = body === undefined || body === null || status === 204 ? '' : JSON.stringify(body);
    res.writeHead(status, Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
    }, corsHeaders(req), extra || {}));
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0, tooBig = false; const chunks = [];
      req.on('data', (c) => {
        if (tooBig) return;                       // se descarta el resto sin guardarlo
        size += c.length;
        if (size > cfg.maxBodyBytes) { tooBig = true; chunks.length = 0; reject(new ApiError(413, 'cuerpo_demasiado_grande', 'La petición es demasiado grande.')); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return;
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new ApiError(400, 'json_invalido', 'El cuerpo no es un JSON válido.')); }
      });
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') return send(req, res, 204);

      const wait = limited(clientIp(req));
      if (wait) return send(req, res, 429, { error: { code: 'demasiadas_peticiones', message: 'Demasiadas peticiones. Intenta de nuevo en unos segundos.' } }, { 'Retry-After': String(wait) });

      let route = null, params = {};
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== req.method) continue;
        route = r;
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        break;
      }
      if (!route) {
        if (pathMatched) throw new ApiError(405, 'metodo_no_permitido', 'Método no permitido.');
        throw new ApiError(404, 'ruta_no_encontrada', 'Ruta no encontrada.');
      }

      const ctx = { cfg, req, params, query: Object.fromEntries(url.searchParams), body: {}, token: null, user: null };
      const auth = req.headers.authorization || '';
      const m = /^Bearer\s+(\S+)$/i.exec(auth);
      if (route.auth !== 'none') {
        if (!m) {
          if (route.auth === 'optional') ctx.token = null;
          else throw new ApiError(401, 'sin_sesion', 'Debes iniciar sesión.');
        } else {
          ctx.token = m[1];
          ctx.user = await supa.getUser(cfg, ctx.token);
        }
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const ct = String(req.headers['content-type'] || '');
        const raw = await readBody(req);
        if (Object.keys(raw).length && !/application\/json/i.test(ct)) throw new ApiError(415, 'tipo_no_soportado', 'Usa Content-Type: application/json.');
        ctx.body = raw;
      }
      const out = await route.handler(ctx);
      return send(req, res, out.status || 200, out.body);
    } catch (e) {
      if (e instanceof ApiError) return send(req, res, e.status, { error: { code: e.code, message: e.message } }, e.status === 413 ? { Connection: 'close' } : undefined);
      console.error('[error no controlado]', e);
      return send(req, res, 500, { error: { code: 'error_interno', message: 'Ocurrió un error inesperado.' } });
    }
  }

  return http.createServer(handle);
}

module.exports = { createApp };
