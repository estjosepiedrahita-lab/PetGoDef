/* PetGo: cookies y accesibilidad global */
(function () {
  'use strict';
  var CONSENT_KEY = 'petgo_cookie_preferences_v1';
  var ACCESS_KEY = 'petgo_accessibility_v1';
  function read(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function el(tag, attrs, content) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    if (content) node.innerHTML = content;
    return node;
  }

  function setupCookies() {
    if (read(CONSENT_KEY)) return;
    var banner = el('section', {class:'petgo-cookie-banner', role:'dialog', 'aria-modal':'false', 'aria-labelledby':'petgo-cookie-title', 'aria-describedby':'petgo-cookie-description'});
    banner.innerHTML = '<div class="petgo-cookie-copy"><h2 id="petgo-cookie-title">Tu privacidad importa 🍪</h2><p id="petgo-cookie-description">Usamos cookies necesarias para que PetGo funcione. Las cookies opcionales de analítica nos ayudarían a mejorar el sitio, pero por ahora no activamos herramientas de analítica sin tu permiso.</p><a href="#" class="petgo-cookie-more" id="petgo-cookie-config">Configurar preferencias</a></div><div class="petgo-cookie-actions"><button type="button" class="petgo-cookie-btn secondary" id="petgo-cookie-reject">Rechazar opcionales</button><button type="button" class="petgo-cookie-btn primary" id="petgo-cookie-accept">Aceptar todas</button></div>';
    document.body.appendChild(banner);
    function save(analytics) {
      write(CONSENT_KEY, {necessary:true, analytics:!!analytics, savedAt:new Date().toISOString()});
      banner.remove();
    }
    banner.querySelector('#petgo-cookie-accept').addEventListener('click', function(){save(true);});
    banner.querySelector('#petgo-cookie-reject').addEventListener('click', function(){save(false);});
    banner.querySelector('#petgo-cookie-config').addEventListener('click', function(e){
      e.preventDefault();
      var existing = document.getElementById('petgo-cookie-preferences'); if (existing) existing.remove();
      var modal = el('div', {class:'petgo-cookie-modal-wrap', id:'petgo-cookie-preferences'});
      modal.innerHTML = '<section class="petgo-cookie-modal" role="dialog" aria-modal="true" aria-labelledby="petgo-cookie-pref-title"><button type="button" class="petgo-utility-close" aria-label="Cerrar configuración">×</button><h2 id="petgo-cookie-pref-title">Preferencias de cookies</h2><p>Las cookies necesarias siempre están activas porque permiten el funcionamiento básico de PetGo. Las cookies de analítica son opcionales y no se instalarán herramientas de analítica hasta que exista una integración y hayas dado tu consentimiento.</p><div class="petgo-cookie-option"><div><strong>Cookies necesarias</strong><p>Funcionamiento, seguridad y preferencias básicas.</p></div><span class="petgo-cookie-always">Siempre activas</span></div><label class="petgo-cookie-option"><span><strong>Cookies de analítica</strong><p>Medición de uso para mejorar PetGo (no se activan actualmente por sí solas).</p></span><input type="checkbox" id="petgo-analytics-toggle"></label><div class="petgo-cookie-modal-actions"><button type="button" class="petgo-cookie-btn secondary" id="petgo-cookie-save-essential">Guardar solo necesarias</button><button type="button" class="petgo-cookie-btn primary" id="petgo-cookie-save-preferences">Guardar preferencias</button></div></section>';
      document.body.appendChild(modal);
      var close = function(){modal.remove(); banner.querySelector('#petgo-cookie-config').focus();};
      modal.querySelector('.petgo-utility-close').addEventListener('click',close);
      modal.addEventListener('click',function(ev){if(ev.target===modal)close();});
      modal.querySelector('#petgo-cookie-save-essential').addEventListener('click',function(){save(false);modal.remove();});
      modal.querySelector('#petgo-cookie-save-preferences').addEventListener('click',function(){save(modal.querySelector('#petgo-analytics-toggle').checked);modal.remove();});
      modal.querySelector('.petgo-utility-close').focus();
    });
  }


  function setupAccessibility() {
    var prefs = read(ACCESS_KEY) || {font:100, contrast:false};
    var root = document.documentElement;
    function apply() {
      root.style.setProperty('--petgo-access-font', prefs.font + '%');
      root.classList.toggle('petgo-high-contrast', !!prefs.contrast);
      write(ACCESS_KEY, prefs);
    }
    apply();
    var launcher = el('button', {class:'petgo-access-launcher', type:'button', 'aria-label':'Abrir opciones de accesibilidad', 'aria-expanded':'false', 'aria-controls':'petgo-access-panel'});
    launcher.innerHTML = '<span aria-hidden="true">♿</span><span class="petgo-access-launcher-label">Accesibilidad</span>';
    var panel = el('section', {class:'petgo-access-panel', id:'petgo-access-panel', role:'dialog', 'aria-labelledby':'petgo-access-title', hidden:''});
    panel.innerHTML = '<div class="petgo-access-head"><h2 id="petgo-access-title">Accesibilidad</h2><button type="button" class="petgo-utility-close" aria-label="Cerrar panel">×</button></div><p class="petgo-access-help">Ajusta la visualización y escucha el contenido de la página.</p><div class="petgo-access-font-controls"><span>Tamaño de texto</span><div><button type="button" id="petgo-font-down" aria-label="Disminuir texto">A−</button><strong id="petgo-font-value">100%</strong><button type="button" id="petgo-font-up" aria-label="Aumentar texto">A+</button></div></div><button type="button" class="petgo-access-control" id="petgo-contrast"><span>Alto contraste</span><span class="petgo-access-state" aria-live="polite">Desactivado</span></button><button type="button" class="petgo-access-control" id="petgo-read"><span>Leer contenido de la página</span><span aria-hidden="true">🔊</span></button><button type="button" class="petgo-access-control" id="petgo-stop-read"><span>Detener lectura</span><span aria-hidden="true">⏹</span></button><button type="button" class="petgo-access-control" id="petgo-cookie-reopen"><span>Preferencias de cookies</span><span aria-hidden="true">🍪</span></button><button type="button" class="petgo-access-reset" id="petgo-access-reset">Restaurar ajustes</button>';
    document.body.appendChild(launcher); document.body.appendChild(panel);
    var fontValue = panel.querySelector('#petgo-font-value'), contrastState = panel.querySelector('.petgo-access-state'), contrastBtn = panel.querySelector('#petgo-contrast');
    function updatePanel(){fontValue.textContent=prefs.font+'%';contrastState.textContent=prefs.contrast?'Activado':'Desactivado';contrastBtn.setAttribute('aria-pressed',String(!!prefs.contrast));}
    updatePanel();
    function closePanel(){panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.focus();}
    launcher.addEventListener('click',function(){panel.hidden=!panel.hidden;launcher.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)panel.querySelector('.petgo-utility-close').focus();});
    panel.querySelector('.petgo-utility-close').addEventListener('click',closePanel);
    panel.querySelector('#petgo-font-down').addEventListener('click',function(){prefs.font=Math.max(85,prefs.font-5);apply();updatePanel();});
    panel.querySelector('#petgo-font-up').addEventListener('click',function(){prefs.font=Math.min(150,prefs.font+5);apply();updatePanel();});
    contrastBtn.addEventListener('click',function(){prefs.contrast=!prefs.contrast;apply();updatePanel();});
    panel.querySelector('#petgo-access-reset').addEventListener('click',function(){prefs={font:100,contrast:false};apply();updatePanel();});
    panel.querySelector('#petgo-cookie-reopen').addEventListener('click',function(){try{localStorage.removeItem(CONSENT_KEY);}catch(e){};var existing=document.querySelector('.petgo-cookie-banner');if(existing)existing.remove();setupCookies();var banner=document.querySelector('.petgo-cookie-banner');if(banner)banner.querySelector('#petgo-cookie-config').focus();panel.hidden=true;launcher.setAttribute('aria-expanded','false');});
    panel.querySelector('#petgo-read').addEventListener('click',function(){
      if(!('speechSynthesis' in window)){alert('Tu navegador no permite lectura en voz alta.');return;}
      window.speechSynthesis.cancel();var text=document.querySelector('main')||document.body;var clone=text.cloneNode(true);clone.querySelectorAll('script,style,button,input,textarea,select,[aria-hidden="true"]').forEach(function(n){n.remove();});var speech=new SpeechSynthesisUtterance(clone.innerText||clone.textContent);speech.lang=document.documentElement.lang||'es';window.speechSynthesis.speak(speech);
    });
    panel.querySelector('#petgo-stop-read').addEventListener('click',function(){if(window.speechSynthesis)window.speechSynthesis.cancel();});
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&!panel.hidden)closePanel();});
  }
  function start(){setupCookies();setupAccessibility();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
