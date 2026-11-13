'use strict';
const cfgMod = require('./src/config');
cfgMod.loadDotEnv(cfgMod.defaultEnvFile);

const cfg = cfgMod.load();
const faltan = cfgMod.validate(cfg);
if (faltan.length) {
  console.error('Faltan o son inválidas estas variables de entorno: ' + faltan.join(', ') + '. Revisa .env.example.');
  process.exit(1);
}
if (!cfg.allowedOrigins.length) console.warn('Aviso: ALLOWED_ORIGINS está vacío; ningún sitio web podrá llamar a la API desde el navegador.');

const { createApp } = require('./src/http');
const { routes } = require('./src/routes');

const server = createApp(cfg, routes);
server.listen(cfg.port, () => console.log(`API de PetGo escuchando en el puerto ${cfg.port}`));

function stop() { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
