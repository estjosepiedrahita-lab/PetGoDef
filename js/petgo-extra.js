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
  $('business-address-label').textContent=providerType()==='empresa'?'Dirección del local':'Dirección del local (obligatoria si ofreces baño o peluquería)';
  document.querySelectorAll('.owner-only').forEach(el=>el.hidden=pro);
  $('registration-info-subtitle').textContent=pro?'Completa los datos para tu perfil profesional.':'Solo necesitamos tus datos de contacto.';
  $('registration-final-note').textContent=pro?'Crearemos tu cuenta y tu perfil profesional para que puedas publicar tus servicios.':'Al crear tu cuenta, podrás continuar con PetGo.';
  $('btn-register').textContent=pro?'Crear cuenta de proveedor':'Crear cuenta';
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
   required['business-address']=providerType()==='empresa'&&!get('business-address')?'Una empresa debe indicar la dirección de su local.':'';
   required['business-phone']=!get('business-phone')||/^[0-9+()\s-]{7,20}$/.test(get('business-phone'))?'':'Solo números, espacios, + ( ) y guiones.';
   if(providerType()==='empresa')required['business-size']=Number(get('business-size'))>=2&&Number(get('business-size'))<=500?'':'Indica entre 2 y 500 personas.';
 }
 Object.entries(required).forEach(([id,msg])=>{error(id,msg);if(msg)ok=false});return ok;}
 $('registration-next').addEventListener('click',()=>{if(step===2&&!validateSecond())return;step=Math.min(3,step+1);render()});
 $('registration-back').addEventListener('click',()=>{step=Math.max(1,step-1);render()});
 roles.forEach(el=>el.addEventListener('change',render));
 ['r-nombre','r-correo','business-name','business-zone','business-address','business-phone','business-size','r-pass','r-pass2'].forEach(id=>$(id).addEventListener('input',()=>error(id,'')));
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

/* ================= Panel del proveedor (datos reales vía app.js → API/Supabase) ================= */
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const title=s=>s==='paseo'?'Paseos':'Baño y peluquería';
const money=n=>'$'+Number(n||0).toLocaleString('es-CO');
const fmtDate=iso=>{const [y,m,d]=String(iso).split('-');return d+'/'+m+'/'+y};
const fmtTime=t=>{const [h,m]=String(t).split(':').map(Number);return ((h%12)||12)+':'+String(m).padStart(2,'0')+' '+(h<12?'AM':'PM')};
let business=null,offers=[],appointments=[],workers=[];
let editingOffer=null,editingWorker=null,D=null,toast=()=>{};
const fail=(msg,e)=>{console.error(msg,e);toast(msg,true)};
const PG=()=>window.PetGo;
const photoUrl=path=>path?PG().profileUrl(path):'';
const ini=n=>(String(n||'?').trim().charAt(0)||'?').toUpperCase();
function avatarHtml(path,name,cls){const u=photoUrl(path);return u?`<span class="avatar ${cls||'m'} has-img"><img src="${esc(u)}" alt="${esc(name)}" loading="lazy"></span>`:`<span class="avatar ${cls||'m'}">${esc(ini(name))}</span>`}
// Prepara un selector de foto con vista previa: devuelve el estado {file, clear}
function photoPicker(inputId,prevId,clearId,getPath,fallback){
 const st={file:null,clear:false,url:null},inp=$(inputId),prev=$(prevId),clr=$(clearId);
 function paint(){
  const u=st.url||(!st.clear&&getPath()?photoUrl(getPath()):'');
  prev.classList.remove('has-img');prev.textContent=fallback;
  if(u)PG().paintPhoto(prev,u,'');
  clr.hidden=!(st.url||(!st.clear&&getPath()));
 }
 inp.onchange=()=>{const f=inp.files&&inp.files[0];if(!f)return;if(!/^image\//.test(f.type)){toast('Selecciona una imagen válida.',true);inp.value='';return}
  if(st.url)URL.revokeObjectURL(st.url);st.file=f;st.clear=false;st.url=URL.createObjectURL(f);paint()};
 clr.onclick=()=>{if(st.url)URL.revokeObjectURL(st.url);st.file=null;st.url=null;st.clear=true;inp.value='';paint()};
 st.reset=()=>{if(st.url)URL.revokeObjectURL(st.url);st.file=null;st.url=null;st.clear=false;inp.value='';paint()};
 st.paint=paint;
 // devuelve {path} si hay que cambiar la foto (path null = quitar) o null si no cambia
 st.commit=async()=>{if(st.file)return {path:await PG().uploadPhoto(st.file)};if(st.clear)return {path:null};return null};
 return st;
}
let profilePhoto=null,workerPhoto=null;

function render(){
 const company=business.tipo==='empresa';
 $('provider-greeting').textContent=business.nombre;$('provider-sidebar-name').textContent=business.nombre;
 $('provider-sidebar-type').textContent=company?'Cuenta empresa':'Cuenta independiente';$('provider-label').textContent=company?'Empresa':'Independiente';
 $('stat-services').textContent=offers.length;$('stat-available').textContent=offers.filter(x=>x.disponible).length;
 $('stat-appointments').textContent=appointments.filter(a=>a.estado==='confirmada').length;
 $('stat-workers').textContent=company?Math.max(workers.length,business.cantidad||0):1;
 $('equipo').hidden=!company;$('team-nav').hidden=!company;
 $('offers-list').innerHTML=offers.length?offers.map(o=>`<article class="card provider-item"><div><h3>${esc(title(o.servicio))}</h3><p>${esc(o.descripcion)}</p><small>${money(o.precio)} · ${esc(o.duracion_min)} min · ${esc(o.horario||'')}</small><span class="badge ${o.disponible?'ok':'no'}">${o.disponible?'Disponible':'Sin cupos'}</span></div><div class="provider-item-actions"><button class="btn sec sm" data-toggle-offer="${esc(o.id)}">${o.disponible?'Marcar sin cupos':'Marcar disponible'}</button><button class="btn sec sm" data-edit-offer="${esc(o.id)}">Editar</button><button class="btn danger sm" data-remove-offer="${esc(o.id)}">Eliminar</button></div></article>`).join(''):'<p class="hist-note">Todavía no has publicado servicios. Crea el primero para aparecer en el catálogo.</p>';
 $('appointment-list').innerHTML=appointments.length?appointments.map(a=>`<article class="card provider-item"><div><h3>${esc(a.cliente)} · ${esc(a.pet_nombre)}</h3><p>${esc(a.servicio)} · ${esc(fmtDate(a.fecha))} a las ${esc(fmtTime(a.hora))}</p><small>Estado: ${a.estado==='confirmada'?'Confirmada':'Cancelada'}</small></div></article>`).join(''):'<p class="hist-note">Aún no tienes citas. Aparecerán aquí cuando un cliente reserve uno de tus servicios.</p>';
 $('workers-list').innerHTML=workers.length?workers.map(w=>`<article class="card provider-item with-photo">${avatarHtml(w.foto_path,w.nombre,'l')}<div><h3>${esc(w.nombre)}</h3><p>${esc(w.funcion)}</p><small>${esc(w.descripcion)}</small></div><div class="provider-item-actions"><button class="btn sec sm" data-worker-edit="${esc(w.id)}">Editar</button><button class="btn danger sm" data-worker-delete="${esc(w.id)}">Eliminar</button></div></article>`).join(''):'<p class="hist-note">Todavía no has agregado trabajadores.</p>';
 $('provider-summary-name').textContent=business.nombre;$('provider-summary-type').textContent=company?'Empresa':'Independiente';
 $('provider-summary-zone').textContent=business.zona||'Sin definir';
 $('provider-summary-address').textContent=business.direccion||'Sin definir';
 $('provider-summary-phone').textContent=business.telefono||'Sin definir';
 {const av=$('provider-summary-photo');av.classList.remove('has-img');av.textContent=company?'🏢':'🙂';if(business.foto_path)PG().paintPhoto(av,photoUrl(business.foto_path),business.nombre)}
 {const side=$('provider-sidebar-avatar');if(side){side.classList.remove('has-img');side.textContent=company?'🏢':'🙂';if(business.foto_path)PG().paintPhoto(side,photoUrl(business.foto_path),business.nombre)}}
 $('provider-address-alert').hidden=!!business.direccion||!(company||offers.some(o=>o.servicio==='bano'));
 $('provider-summary-kind').textContent=company?'Empresa con varios profesionales':'Profesional independiente';
 $('provider-summary-workers').textContent=company?String(workers.length)+' registrados':'1 persona';
 $('provider-summary-description').textContent=business.descripcion||'Todavía no has añadido una descripción.';
 $('profile-business-phone').value=business.telefono||'';$('profile-business-address').value=business.direccion||'';
 $('profile-address-hint').textContent=company?'Obligatoria para empresas: los clientes la verán en tu perfil.':'Obligatoria si ofreces baño o peluquería (los clientes deben saber dónde llevar a su mascota). Si solo haces paseos puedes dejarla vacía.';
 $('profile-business-name').value=business.nombre;$('profile-business-zone').value=business.zona;$('profile-business-description').value=business.descripcion||'';
}

async function loadAll(){
 const rs=await Promise.all([D.offers.list(),D.workers.list(),D.citas.list()]);
 const err=rs.find(r=>r.error);if(err)throw err.error;
 offers=rs[0].data;workers=rs[1].data;appointments=rs[2].data;
}
async function refreshCitas(){
 const r=await D.citas.list();
 if(!r.error){appointments=r.data;render()}
}
async function busy(btn,fn){
 if(btn)btn.disabled=true;
 try{return await fn()}finally{if(btn)btn.disabled=false}
}

function openOffer(id){
 const o=offers.find(x=>x.id===id);editingOffer=id||null;$('offer-form').hidden=false;
 $('offer-form-title').textContent=o?'Editar servicio':'Nuevo servicio';
 $('offer-service').value=o?.servicio||'paseo';$('offer-price').value=o?.precio||'';$('offer-duration').value=o?.duracion_min||30;
 {const dias=o?.dias||[1,2,3,4,5];document.querySelectorAll('#offer-days input').forEach(i=>{i.checked=dias.includes(Number(i.value))});$('offer-start').value=(o?.hora_inicio||'08:00').slice(0,5);$('offer-end').value=(o?.hora_fin||'18:00').slice(0,5)}$('offer-description').value=o?.descripcion||'';$('offer-available').checked=o?.disponible!==false;
 $('offer-form').scrollIntoView({behavior:'smooth',block:'center'});
}
function openWorker(id){
 const w=workers.find(x=>x.id===id);editingWorker=id||null;$('worker-form').hidden=false;
 $('worker-form-title').textContent=w?'Editar trabajador':'Agregar trabajador';
 workerPhoto.reset();$('worker-name').value=w?.nombre||'';$('worker-role').value=w?.funcion||'Paseador';$('worker-description').value=w?.descripcion||'';
 $('worker-form').scrollIntoView({behavior:'smooth'});
}

function bindEvents(){
 profilePhoto=photoPicker('profile-photo','profile-photo-prev','profile-photo-clear',()=>business.foto_path,'🏢');
 workerPhoto=photoPicker('worker-photo','worker-photo-prev','worker-photo-clear',()=>{const w=workers.find(x=>x.id===editingWorker);return w&&w.foto_path},'👤');
 $('new-offer').onclick=()=>openOffer();$('offer-cancel').onclick=()=>{$('offer-form').hidden=true};
 $('offer-form').onsubmit=async e=>{e.preventDefault();
  const dias=[...document.querySelectorAll('#offer-days input:checked')].map(i=>Number(i.value));
  const o={servicio:$('offer-service').value,precio:Number($('offer-price').value),duracion_min:Number($('offer-duration').value),dias,hora_inicio:$('offer-start').value,hora_fin:$('offer-end').value,descripcion:$('offer-description').value.trim(),disponible:$('offer-available').checked};
  const mins=t=>{const [h,m]=t.split(':').map(Number);return h*60+m};
  if(!Number.isInteger(o.precio)||o.precio<1000||o.duracion_min<10)return toast('Revisa el precio (mínimo $1.000) y la duración (mínimo 10 min).',true);
  if(!dias.length)return toast('Elige al menos un día de atención.',true);
  if(!o.hora_inicio||!o.hora_fin||mins(o.hora_inicio)<7*60||mins(o.hora_fin)>20*60||mins(o.hora_fin)<=mins(o.hora_inicio))return toast('El horario debe estar entre las 7:00 AM y las 8:00 PM, y la hora final debe ser posterior a la inicial.',true);
  if(mins(o.hora_inicio)+o.duracion_min>mins(o.hora_fin))return toast('La duración del servicio no cabe en el horario de atención.',true);
  if((o.servicio==='bano'||business.tipo==='empresa')&&!business.direccion){toast('Primero agrega la dirección de tu local en tu perfil: los clientes deben saber dónde llevar a su mascota.',true);document.querySelector('[data-provider-view=perfil]').click();return}
  await busy(e.submitter,async()=>{
   const r=editingOffer?await D.offers.update(editingOffer,o):await D.offers.create(o,business.id);
   if(r.error)return fail(r.error.code==='direccion_requerida'?'Primero agrega la dirección de tu local en tu perfil.':'No se pudo guardar el servicio.',r.error);
   offers=editingOffer?offers.map(x=>x.id===editingOffer?r.data:x):offers.concat(r.data);
   $('offer-form').hidden=true;render();toast('Servicio guardado.');
  });
 };
 $('offers-list').onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.editOffer)return openOffer(b.dataset.editOffer);
  if(b.dataset.toggleOffer){
   const o=offers.find(x=>x.id===b.dataset.toggleOffer);
   return busy(b,async()=>{const r=await D.offers.update(o.id,{disponible:!o.disponible});if(r.error)return fail('No se pudo cambiar la disponibilidad.',r.error);offers=offers.map(x=>x.id===o.id?r.data:x);render()});
  }
  if(b.dataset.removeOffer&&confirm('¿Eliminar este servicio?'))busy(b,async()=>{
   const r=await D.offers.remove(b.dataset.removeOffer);
   if(r.error)return fail(r.error.code==='oferta_con_reservas'?'Este servicio ya tiene reservas. Márcalo como "sin cupos" en lugar de eliminarlo.':'No se pudo eliminar el servicio.',r.error);
   offers=offers.filter(x=>x.id!==b.dataset.removeOffer);render();
  });
 };
 // Las citas son de solo lectura: las crean los clientes al reservar.
 $('new-appointment').hidden=true;$('appointment-form').remove();

 $('new-worker').onclick=()=>openWorker();$('worker-cancel').onclick=()=>{$('worker-form').hidden=true};
 $('worker-form').onsubmit=async e=>{e.preventDefault();
  const w={nombre:$('worker-name').value.trim(),funcion:$('worker-role').value,descripcion:$('worker-description').value.trim()};
  await busy(e.submitter,async()=>{
   const old=editingWorker?workers.find(x=>x.id===editingWorker)?.foto_path:null;let ch=null;
   try{ch=await workerPhoto.commit();if(ch)w.foto_path=ch.path}catch(er){return fail('No se pudo subir la foto.',er)}
   const r=editingWorker?await D.workers.update(editingWorker,w):await D.workers.create(w,business.id);
   if(r.error){if(ch&&ch.path)PG().removePhoto(ch.path);return fail('No se pudo guardar al trabajador.',r.error)}
   if(ch&&old)PG().removePhoto(old);
   workers=editingWorker?workers.map(x=>x.id===editingWorker?r.data:x):workers.concat(r.data);
   if(business.tipo==='empresa'&&workers.length>business.cantidad){const u=await D.biz.update(business.id,{cantidad:workers.length});if(!u.error)business=u.data}
   $('worker-form').hidden=true;render();toast('Trabajador guardado.');
  });
 };
 $('workers-list').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.workerEdit)return openWorker(b.dataset.workerEdit);
  if(b.dataset.workerDelete&&confirm('¿Eliminar este trabajador?'))busy(b,async()=>{
   const r=await D.workers.remove(b.dataset.workerDelete);if(r.error)return fail('No se pudo eliminar al trabajador.',r.error);
   workers=workers.filter(x=>x.id!==b.dataset.workerDelete);render();
  });
 };
 $('provider-edit-profile').onclick=()=>{profilePhoto.paint();$('business-profile-form').hidden=false;$('provider-profile-summary').hidden=true;$('provider-edit-profile').hidden=true};
 $('provider-profile-cancel').onclick=()=>{profilePhoto.reset();$('business-profile-form').hidden=true;$('provider-profile-summary').hidden=false;$('provider-edit-profile').hidden=false;render()};
 $('business-profile-form').onsubmit=async e=>{e.preventDefault();
  const p={nombre:$('profile-business-name').value.trim(),zona:$('profile-business-zone').value.trim(),descripcion:$('profile-business-description').value.trim(),telefono:$('profile-business-phone').value.trim(),direccion:$('profile-business-address').value.trim()};
  if(!p.nombre||!p.zona)return toast('El nombre y la zona son obligatorios.',true);
  if(p.telefono&&!/^[0-9+()\s-]{7,20}$/.test(p.telefono))return toast('Revisa el teléfono: solo números, espacios, + ( ) y guiones.',true);
  if(business.tipo==='empresa'&&!p.direccion)return toast('Una empresa debe indicar la dirección de su local.',true);
  if(!p.direccion&&offers.some(o=>o.servicio==='bano'))return toast('Tienes servicios de baño o peluquería: la dirección es obligatoria.',true);
  await busy(e.submitter,async()=>{
   const old=business.foto_path;let ch=null;
   try{ch=await profilePhoto.commit();if(ch)p.foto_path=ch.path}catch(er){return fail('No se pudo subir la foto.',er)}
   const r=await D.biz.update(business.id,p);if(r.error){if(ch&&ch.path)PG().removePhoto(ch.path);return fail('No se pudo guardar el perfil.',r.error)}
   if(ch&&old)PG().removePhoto(old);profilePhoto.reset();
   business=r.data;
   const o=await D.offers.list();if(!o.error)offers=o.data;
   $('business-profile-form').hidden=true;$('provider-profile-summary').hidden=false;$('provider-edit-profile').hidden=false;render();toast('Perfil actualizado.');
  });
 };

 const sidebar=$('provider-sidebar'),menuToggle=$('provider-menu-toggle'),backdrop=$('provider-sidebar-backdrop');
 function closeMenu(){sidebar.classList.remove('open');backdrop.hidden=true;menuToggle.setAttribute('aria-expanded','false')}
 function switchView(view){
  if(view==='equipo'&&business.tipo!=='empresa')view='resumen';
  if(!['resumen','ofertas','citas','equipo','perfil'].includes(view))view='resumen';
  document.querySelectorAll('.provider-view').forEach(el=>{el.hidden=el.dataset.view!==view});
  document.querySelectorAll('.provider-side-link[data-provider-view]').forEach(el=>{const active=el.dataset.providerView===view;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')});
  if(view!=='perfil'){$('business-profile-form').hidden=true;$('provider-profile-summary').hidden=false;$('provider-edit-profile').hidden=false}
  history.replaceState(null,'','#'+view);closeMenu();window.scrollTo({top:0,behavior:'instant'});
  if(view==='citas'||view==='resumen')refreshCitas();
 }
 document.querySelectorAll('[data-provider-view]').forEach(el=>el.addEventListener('click',e=>{e.preventDefault();switchView(el.dataset.providerView)}));
 menuToggle.onclick=()=>{const open=!sidebar.classList.contains('open');sidebar.classList.toggle('open',open);backdrop.hidden=!open;menuToggle.setAttribute('aria-expanded',String(open))};
 backdrop.onclick=closeMenu;document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
 window.addEventListener('hashchange',()=>switchView(location.hash.slice(1)));
 $('provider-logout').onclick=async()=>{closeMenu();await window.PetGo.logout()};
 switchView(location.hash.slice(1)||'resumen');
}

(async function start(){
 if(!window.PetGo){document.body.insertAdjacentHTML('afterbegin','<p class="hist-note" style="padding:24px">No se pudo cargar PetGo. Recarga la página.</p>');return}
 const ctx=await window.PetGo.ready;
 if(!ctx)return; // sin sesión: app.js ya redirigió al login
 D=ctx.D;toast=ctx.toast;
 try{
  let r=await D.biz.get();if(r.error)throw r.error;
  business=r.data;
  if(!business){
   // Primer ingreso tras registrarse: se crea el negocio con los datos guardados en el registro
   let pending=null;try{pending=JSON.parse(localStorage.getItem('petgo_business_pending')||'null')}catch(e){}
   if(!pending){
    const me=await D.me.get();
    if(me.data&&me.data.rol==='proveedor')pending={tipo:'individual',nombre:me.data.nombre||'Mi negocio',zona:'Bogotá'};
    else{location.replace('dashboard.html');return}
   }
   r=await D.biz.create(pending);if(r.error)throw r.error;
   business=r.data;try{localStorage.removeItem('petgo_business_pending')}catch(e){}
  }
  await loadAll();
 }catch(e){fail('No se pudo cargar tu panel. Recarga la página.',e);return}
 bindEvents();render();
})();
})();
