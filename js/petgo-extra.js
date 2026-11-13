(function(){"use strict";
const $=id=>document.getElementById(id), read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},write=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
if($('registration-wizard')){
 const root=$('registration-wizard');
 const role=()=>document.querySelector('input[name="account-role"]:checked').value;
 const providerType=()=>document.querySelector('input[name="provider-type"]:checked').value;
 const roles=document.querySelectorAll('input[name="account-role"],input[name="provider-type"]');
 let step=1;
 const get=id=>$(id).value.trim();
 const error=(id,message)=>{const field=$(id).closest('.field');const slot=field?.querySelector('.msg');if(slot)slot.textContent=message;field?.classList.toggle('error',!!message);$(id).setAttribute('aria-invalid',message?'true':'false')};
 const pageError=message=>{$('registration-page-error').textContent=message;$('registration-page-error').hidden=!message};
 const provider=()=>role()==='proveedor';
 function render(){
  const pro=provider();document.body.classList.toggle('provider-signup',pro);
  $('provider-type-choice').hidden=!pro;
  $('provider-registration').hidden=!pro;
  $('business-size-row').hidden=providerType()!=='empresa';
  document.querySelectorAll('.owner-only').forEach(el=>el.hidden=pro);
  $('registration-info-subtitle').textContent=pro?'Completa los datos para tu perfil profesional.':'Solo necesitamos tus datos de contacto.';
  $('registration-final-note').textContent=pro?'Tu perfil se guardará en este navegador como demostración, sin crear una cuenta real.':'Al crear tu cuenta, podrás continuar con PetGo.';
  $('btn-register').textContent=pro?'Crear perfil de demostración':'Crear cuenta';
  [1,2,3].forEach(n=>{$('registration-step-'+n).hidden=n!==step});
  $('registration-back').hidden=step===1;$('registration-next').hidden=step===3;$('btn-register').hidden=step!==3;
  $('registration-step-label').textContent='PASO '+step+' DE 3';$('registration-progress-fill').style.width=(step/3*100)+'%';
  root.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(step));pageError('');
 }
 function validateSecond(){let ok=true;const required={
  'r-nombre':get('r-nombre')?'':'Escribe tu nombre.',
  'r-correo':/^\S+@\S+\.\S+$/.test(get('r-correo'))?'':'Ingresa un correo válido.'
 };if(provider()){
   required['business-name']=get('business-name')?'':'Escribe un nombre profesional o comercial.';
   required['business-zone']=get('business-zone')?'':'Indica tu zona de atención.';
   if(providerType()==='empresa')required['business-size']=Number(get('business-size'))>=2&&Number(get('business-size'))<=500?'':'Indica entre 2 y 500 personas.';
 }
 Object.entries(required).forEach(([id,msg])=>{error(id,msg);if(msg)ok=false});return ok;}
 $('registration-next').addEventListener('click',()=>{if(step===2&&!validateSecond())return;step=Math.min(3,step+1);render()});
 $('registration-back').addEventListener('click',()=>{step=Math.max(1,step-1);render()});
 roles.forEach(el=>el.addEventListener('change',render));
 ['r-nombre','r-correo','business-name','business-zone','business-size','r-pass','r-pass2'].forEach(id=>$(id).addEventListener('input',()=>error(id,'')));
 $('btn-register').addEventListener('click',e=>{
  if(!validateSecond()){e.preventDefault();step=2;render();pageError('Revisa los campos marcados para continuar.');return}
  const pass=$('r-pass').value,confirm=$('r-pass2').value;
  if(pass.length<6||pass!==confirm){e.preventDefault();error('r-pass',pass.length<6?'Mínimo 6 caracteres.':'');error('r-pass2',pass!==confirm?'Las contraseñas no coinciden.':'');return}
 });
 root.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'&&e.target.type!=='radio'){
  e.preventDefault();if(step<3)$('registration-next').click();else $('btn-register').click();
 }});
 render();
}
if(!$('provider-panel'))return;
let business=read('petgo_business',null);
if(!business){business={tipo:'empresa',nombre:'Mi negocio PetGo',responsable:'',zona:'Bogotá',descripcion:'',cantidad:2,empleados:[]};write('petgo_business',business)}
let offers=read('petgo_business_offers',[]),appointments=read('petgo_appointments',[]),workers=business.empleados||[];
let editingOffer=null,editingWorker=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const title=s=>s==='paseo'?'Paseos':'Baño y peluquería';
const money=n=>'$'+Number(n||0).toLocaleString('es-CO');
const save=()=>{business.empleados=workers;write('petgo_business',business);write('petgo_business_offers',offers);write('petgo_appointments',appointments);render()};
function render(){
 $('provider-greeting').textContent=business.nombre;$('provider-sidebar-name').textContent=business.nombre;$('provider-sidebar-type').textContent=business.tipo==='empresa'?'Cuenta empresa':'Cuenta independiente';$('provider-label').textContent=business.tipo==='empresa'?'Empresa':'Independiente';
 $('stat-services').textContent=offers.length;$('stat-available').textContent=offers.filter(x=>x.disponible).length;$('stat-appointments').textContent=appointments.length;$('stat-workers').textContent=business.tipo==='empresa'?Math.max(workers.length,business.cantidad||0):1;
 const company=business.tipo==='empresa';$('equipo').hidden=!company;$('team-nav').hidden=!company;
 $('offers-list').innerHTML=offers.length?offers.map(o=>`<article class="card provider-item"><div><h3>${esc(title(o.servicio))}</h3><p>${esc(o.descripcion)}</p><small>${money(o.precio)} · ${esc(o.duracion_min)} min · ${esc(o.horario)}</small><span class="badge ${o.disponible?'ok':'no'}">${o.disponible?'Disponible':'Sin cupos'}</span></div><div class="provider-item-actions"><button class="btn sec sm" data-edit-offer="${esc(o.id)}">Editar</button><button class="btn danger sm" data-remove-offer="${esc(o.id)}">Eliminar</button></div></article>`).join(''):'<p class="hist-note">Todavía no has publicado servicios. Crea el primero para aparecer en el catálogo.</p>';
 $('appointment-list').innerHTML=appointments.length?appointments.map(a=>`<article class="card provider-item"><div><h3>${esc(a.cliente)} · ${esc(a.mascota)}</h3><p>${esc(title(a.servicio))} · ${esc(a.fecha)} a las ${esc(a.hora)}</p><small>Estado: ${esc(a.estado||'Pendiente')}</small></div><div class="provider-item-actions"><button class="btn sec sm" data-appointment-status="${esc(a.id)}">${a.estado==='Confirmada'?'Marcar completada':'Confirmar'}</button><button class="btn danger sm" data-appointment-delete="${esc(a.id)}">Eliminar</button></div></article>`).join(''):'<p class="hist-note">Aún no hay citas de demostración.</p>';
 $('workers-list').innerHTML=workers.length?workers.map(w=>`<article class="card provider-item"><div><h3>${esc(w.nombre)}</h3><p>${esc(w.funcion)}</p><small>${esc(w.descripcion)}</small></div><div class="provider-item-actions"><button class="btn sec sm" data-worker-edit="${esc(w.id)}">Editar</button><button class="btn danger sm" data-worker-delete="${esc(w.id)}">Eliminar</button></div></article>`).join(''):'<p class="hist-note">Aún no has agregado trabajadores.</p>';
 $('provider-summary-name').textContent=business.nombre;$('provider-summary-type').textContent=business.tipo==='empresa'?'Empresa':'Independiente';$('provider-summary-zone').textContent=business.zona||'Sin definir';$('provider-summary-kind').textContent=business.tipo==='empresa'?'Empresa con varios profesionales':'Profesional independiente';$('provider-summary-workers').textContent=business.tipo==='empresa'?String(workers.length)+' registrados':'1 persona';$('provider-summary-description').textContent=business.descripcion||'Todavía no has añadido una descripción.';
 $('profile-business-name').value=business.nombre;$('profile-business-zone').value=business.zona;$('profile-business-description').value=business.descripcion||'';
}
$('new-offer').onclick=()=>openOffer();$('offer-cancel').onclick=()=>{$('offer-form').hidden=true};
function openOffer(id){const o=offers.find(x=>x.id===id);editingOffer=id||null;$('offer-form').hidden=false;$('offer-form-title').textContent=o?'Editar servicio':'Nuevo servicio';$('offer-service').value=o?.servicio||'paseo';$('offer-price').value=o?.precio||'';$('offer-duration').value=o?.duracion_min||30;$('offer-hours').value=o?.horario||'';$('offer-description').value=o?.descripcion||'';$('offer-available').checked=o?.disponible!==false;$('offer-form').scrollIntoView({behavior:'smooth',block:'center'})}
$('offer-form').onsubmit=e=>{e.preventDefault();const o={id:editingOffer||'local-'+Date.now(),servicio:$('offer-service').value,precio:Number($('offer-price').value),duracion_min:Number($('offer-duration').value),horario:$('offer-hours').value.trim(),descripcion:$('offer-description').value.trim(),disponible:$('offer-available').checked,activo:true};if(o.precio<1000||o.duracion_min<10)return alert('Revisa el precio y la duración.');if(editingOffer)offers=offers.map(x=>x.id===editingOffer?o:x);else offers.push(o);$('offer-form').hidden=true;save()};
$('offers-list').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.editOffer)openOffer(b.dataset.editOffer);if(b.dataset.removeOffer&&confirm('¿Eliminar este servicio?')){offers=offers.filter(x=>x.id!==b.dataset.removeOffer);save()}};
$('new-appointment').onclick=()=>{$('appointment-form').hidden=false;$('appointment-form').scrollIntoView({behavior:'smooth'})};$('appointment-cancel').onclick=()=>{$('appointment-form').hidden=true};
$('appointment-form').onsubmit=e=>{e.preventDefault();appointments.push({id:'a-'+Date.now(),cliente:$('appointment-client').value.trim(),mascota:$('appointment-pet').value.trim(),fecha:$('appointment-date').value,hora:$('appointment-time').value,servicio:$('appointment-service').value,estado:'Pendiente'});$('appointment-form').reset();$('appointment-form').hidden=true;save()};
$('appointment-list').onclick=e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.appointmentStatus||b.dataset.appointmentDelete;const a=appointments.find(x=>x.id===id);if(!a)return;if(b.dataset.appointmentDelete){if(confirm('¿Eliminar esta cita de ejemplo?'))appointments=appointments.filter(x=>x.id!==id)}else a.estado=a.estado==='Confirmada'?'Completada':'Confirmada';save()};
$('new-worker').onclick=()=>openWorker();$('worker-cancel').onclick=()=>{$('worker-form').hidden=true};
function openWorker(id){const w=workers.find(x=>x.id===id);editingWorker=id||null;$('worker-form').hidden=false;$('worker-form-title').textContent=w?'Editar trabajador':'Agregar trabajador';$('worker-name').value=w?.nombre||'';$('worker-role').value=w?.funcion||'Paseador';$('worker-description').value=w?.descripcion||'';$('worker-form').scrollIntoView({behavior:'smooth'})}
$('worker-form').onsubmit=e=>{e.preventDefault();const w={id:editingWorker||'w-'+Date.now(),nombre:$('worker-name').value.trim(),funcion:$('worker-role').value,descripcion:$('worker-description').value.trim()};if(editingWorker)workers=workers.map(x=>x.id===editingWorker?w:x);else workers.push(w);business.cantidad=workers.length;$('worker-form').hidden=true;save()};
$('workers-list').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.workerEdit)openWorker(b.dataset.workerEdit);if(b.dataset.workerDelete&&confirm('¿Eliminar este trabajador?')){workers=workers.filter(x=>x.id!==b.dataset.workerDelete);business.cantidad=workers.length;save()}};
$('provider-edit-profile').onclick=()=>{ $('business-profile-form').hidden=false;$('provider-profile-summary').hidden=true;$('provider-edit-profile').hidden=true;};
$('provider-profile-cancel').onclick=()=>{ $('business-profile-form').hidden=true;$('provider-profile-summary').hidden=false;$('provider-edit-profile').hidden=false;render();};
$('business-profile-form').onsubmit=e=>{e.preventDefault();business.nombre=$('profile-business-name').value.trim();business.zona=$('profile-business-zone').value.trim();business.descripcion=$('profile-business-description').value.trim();$('business-profile-form').hidden=true;$('provider-profile-summary').hidden=false;$('provider-edit-profile').hidden=false;save()};
const sidebar=$('provider-sidebar'),menuToggle=$('provider-menu-toggle'),backdrop=$('provider-sidebar-backdrop');
function closeMenu(){sidebar.classList.remove('open');backdrop.hidden=true;menuToggle.setAttribute('aria-expanded','false')}
function switchView(view){
 if(view==='equipo'&&business.tipo!=='empresa')view='resumen';
 if(!['resumen','ofertas','citas','equipo','perfil'].includes(view))view='resumen';
 document.querySelectorAll('.provider-view').forEach(el=>{el.hidden=el.dataset.view!==view});
 document.querySelectorAll('.provider-side-link[data-provider-view]').forEach(el=>{const active=el.dataset.providerView===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')});
 if(view!=='perfil'){$('business-profile-form').hidden=true;$('provider-profile-summary').hidden=false;$('provider-edit-profile').hidden=false}
 history.replaceState(null,'','#'+view);closeMenu();window.scrollTo({top:0,behavior:'instant'});
}
document.querySelectorAll('[data-provider-view]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();switchView(el.dataset.providerView)}));
menuToggle.onclick=()=>{const open=!sidebar.classList.contains('open');sidebar.classList.toggle('open',open);backdrop.hidden=!open;menuToggle.setAttribute('aria-expanded',String(open))};
backdrop.onclick=closeMenu;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
$('provider-logout').onclick=async()=>{
 closeMenu();try{sessionStorage.removeItem('petgo_preview');}catch(e){}
 // No eliminar los servicios ni datos locales del negocio al salir.
 try{if(window.supabase&&window.PETGO_SUPABASE){const auth=window.supabase.createClient(window.PETGO_SUPABASE.url,window.PETGO_SUPABASE.key);await auth.auth.signOut()}}catch(e){console.warn('No fue posible cerrar la sesión remota:',e)}
 location.href='login.html';
};
render();switchView(location.hash.slice(1)||'resumen');
})();
