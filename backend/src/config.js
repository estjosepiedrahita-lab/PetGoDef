'use strict';
// Lee la configuración desde variables de entorno (y desde un archivo .env si existe).
const fs = require('fs');
const path = require('path');

function loadDotEnv(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

function load(env = process.env) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  const cfg = {
    supabaseUrl: url,
    supabaseKey: env.SUPABASE_KEY || '',
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    port: Number(env.PORT) || 3000,
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN) || 120,
    trustProxy: String(env.TRUST_PROXY || 'true') === 'true',
    requestTimeoutMs: 10000,
    maxBodyBytes: 64 * 1024
  };
  return cfg;
}

function validate(cfg) {
  const faltan = [];
  if (!/^https:\/\/.+/.test(cfg.supabaseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(cfg.supabaseUrl)) faltan.push('SUPABASE_URL');
  if (!cfg.supabaseKey) faltan.push('SUPABASE_KEY');
  if (/^sb_secret_|service_role/.test(cfg.supabaseKey)) {
    throw new Error('SUPABASE_KEY parece una clave secreta. Usa la clave publishable (sb_publishable_...).');
  }
  return faltan;
}

module.exports = { loadDotEnv, load, validate, defaultEnvFile: path.join(__dirname, '..', '.env') };
