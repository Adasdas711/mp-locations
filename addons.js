/* PALACE add-ons: local packages, capability checks and isolated extension hosts. */
'use strict';
const addonPackages=new Map(),addonHosts=new Map();
const ADDON_LIMIT=8*1024*1024;
const addonModal=persistenceModal('addonsModal','Аддоны',`
<p class="addon-intro">Расширения для вашего дворца: инструменты, команды и оформление.</p>
<div class="addon-toolbar"><button id="addonUpload" type="button" aria-expanded="false" aria-controls="addonUploader">＋ Установить аддон</button><label class="addon-mode"><input id="addonMode" type="checkbox" checked> Модульный режим</label></div>
<section id="addonUploader" hidden aria-label="Установка аддона"><div class="addon-upload-heading"><strong>Установка из файла</strong><button id="addonUploadClose" type="button" aria-label="Закрыть установку">×</button></div><label id="addonDrop" for="addonFile" role="button" tabindex="0"><svg class="ic"><use href="#i-upload"/></svg><strong>Выберите или перетащите пакет</strong><span>.palace-addon или ZIP · до 8 МБ</span></label><input id="addonFile" type="file" accept=".zip,.palace-addon" tabindex="-1" aria-hidden="true"><span id="addonFileName">Файл не выбран</span><div id="addonInstallPreview" hidden></div></section>
<label class="addon-search" for="addonSearch"><svg class="ic"><use href="#i-search"/></svg><input id="addonSearch" type="search" placeholder="Поиск аддонов и команд"></label><div id="addonList"></div><div id="addonStatus" role="status" aria-live="polite"></div><footer class="addon-footer"><span>Пакеты PALACE</span><button id="addonsClose" type="button">Закрыть</button></footer>`);
const addonPanel=persistenceModal('addonPanel','Панель аддона','<div id="addonPanelFrames"></div><button id="addonPanelClose">Закрыть панель</button>');
persistenceStyle.textContent+='\n.addon-card{border:1px solid var(--line);border-radius:4px;padding:12px;margin:10px 0}.addon-runtime{width:100%;height:380px;border:0;background:var(--vscode-editor-bg)}.addon-runtime[hidden]{display:none!important}#addonList .addon-description{color:var(--muted);white-space:pre-wrap}.addon-commands{display:flex;gap:6px;flex-wrap:wrap}.addon-card code{overflow-wrap:anywhere}';
const addonsButton=document.createElement('button');addonsButton.className='abtn';addonsButton.id='addonsOpen';addonsButton.type='button';addonsButton.title='Аддоны';addonsButton.setAttribute('aria-label','Аддоны');addonsButton.innerHTML='<svg class="ic"><use href="#i-braces"/></svg>';
document.querySelector('#abHotkeys').before(addonsButton);
let addonMode=true,pendingAddon=null,addonReadSequence=0;
function addonMessage(message){document.querySelector('#addonStatus').textContent=message;}
function addonStorage(){return new Promise((resolve,reject)=>{const r=indexedDB.open('palace-addons',1);r.onupgradeneeded=()=>r.result.createObjectStore('packages',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Хранилище занято другой вкладкой.'))})}
async function storeAddon(record,remove=false){const db=await addonStorage();try{const tx=db.transaction('packages','readwrite');const complete=idbComplete(tx);if(remove)tx.objectStore('packages').delete(record.id);else tx.objectStore('packages').put(record);await complete}finally{db.close()}}
function safeAddonPath(name){return typeof name==='string'&&name.length<200&&!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').some(p=>!p||p==='.'||p==='..')}
function validateAddon(manifest,files){
 if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('Некорректный manifest.json.');
 if(!/^[a-z][a-z0-9.-]{2,79}$/.test(manifest.id||''))throw new Error('id должен состоять из латинских букв, цифр, точек и дефисов.');
 if(typeof manifest.name!=='string'||!manifest.name.trim()||manifest.name.length>120)throw new Error('Укажите название аддона.');
 if(!/^\d+\.\d+\.\d+$/.test(manifest.version||''))throw new Error('Укажите version в формате 1.0.0.');
 if(manifest.apiVersion!==1)throw new Error('Поддерживается apiVersion: 1.');
 if(!safeAddonPath(manifest.main)||!manifest.main.endsWith('.js')||typeof files[manifest.main]!=='string')throw new Error('Главный JS-файл не найден.');
 if(!Array.isArray(manifest.permissions)||manifest.permissions.some(p=>!['project.read','markers.write','metadata.write','plan.read','plan.write','tour.read','tour.write','view.control','ui.control','ui.contribute','archive.read','archive.write','keybindings.write'].includes(p)))throw new Error('Неизвестное разрешение.');
 const c=manifest.contributes||{},commands=c.commands||[],panels=c.panels||[],activity=c.activityBar||[],toolbars=c.toolbars||[];
 if([commands,panels,activity,toolbars].some(items=>!Array.isArray(items))||commands.length+panels.length+activity.length+toolbars.length>60)throw new Error('Не более 60 элементов интерфейса.');
 const ids=new Set();
 for(const item of [...commands,...panels,...activity,...toolbars]){
  if(!item||typeof item.id!=='string'||!item.id.startsWith(manifest.id+'.')||ids.has(item.id)||typeof item.title!=='string'||!item.title||item.title.length>120)throw new Error('Некорректный или повторяющийся элемент интерфейса.');ids.add(item.id);
 }
 for(const item of [...activity,...toolbars])if(!commands.some(command=>command.id===item.command))throw new Error('Инструмент ссылается на необъявленную команду.');
 for(const item of toolbars)if(!['plan','tour','header','status'].includes(item.location))throw new Error('Неизвестная панель инструментов.');
 if((activity.length||toolbars.length)&&!manifest.permissions.includes('ui.contribute'))throw new Error('Для инструментов нужно разрешение ui.contribute.');
 return manifest;
}
async function readAddon(file){
 if(file.size>ADDON_LIMIT)throw new Error('Аддон должен быть меньше 8 МБ.');
 const zip=await JSZip.loadAsync(await file.arrayBuffer());const entries=Object.values(zip.files).filter(e=>!e.dir);
 if(entries.length>100)throw new Error('Слишком много файлов.');
 const files={};let total=0;
 for(const entry of entries){
  if(!safeAddonPath(entry.name)||entry.unsafeOriginalName&&entry.unsafeOriginalName!==entry.name)throw new Error('Недопустимый путь в архиве.');
  if(entry._data?.uncompressedSize>ADDON_LIMIT)throw new Error('Распакованный файл слишком большой.');
  const data=await entry.async('uint8array');total+=data.length;if(total>ADDON_LIMIT)throw new Error('Распакованный аддон больше 8 МБ.');
  files[entry.name]=/\.(png|jpe?g|webp|avif)$/i.test(entry.name)?bufferToDataURL(data,mimeByExt(entry.name)):new TextDecoder('utf-8',{fatal:true}).decode(data);
 }
 if(!files['manifest.json'])throw new Error('В корне ZIP нужен manifest.json.');
 const manifest=validateAddon(JSON.parse(files['manifest.json']),files);
 return {id:manifest.id,manifest,files,enabled:true};
}
function addonHostDocument(record,channel){
 const payload=JSON.stringify({files:record.files,main:record.manifest.main,channel}).replace(/</g,'\\u003c');
 return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>body{margin:0;padding:14px;background:#1f1f1f;color:#ccc;font:14px/1.5 system-ui}button,input{font:inherit}button{padding:6px 12px}</style></head><body><div id="panel"></div><script>
const data=${payload};const handlers=new Map(),pending=new Map(),listeners=new Set();let seq=0,extension;
const send=(type,body)=>parent.postMessage({channel:data.channel,type,...body},'*');
window.addEventListener('error',event=>{event.preventDefault();send('error',{message:event.message})});
window.addEventListener('unhandledrejection',event=>{event.preventDefault();send('error',{message:String(event.reason?.message||event.reason)})});
function rpc(method,args){return new Promise((resolve,reject)=>{const id=++seq;const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('API timeout'))},10000);pending.set(id,{resolve,reject,timeout});send('rpc',{id,method,args})})}
const api=Object.freeze({
 version:'1.3.0',
 commands:{register(id,handler){if(typeof handler!=='function')throw new Error('Command requires a handler');handlers.set(id,handler);send('register',{id});return {dispose(){handlers.delete(id);send('unregister',{id})}}}},
 project:{read:()=>rpc('project.read'),updateMetadata:patch=>rpc('metadata.write',patch)},
 markers:{add:input=>rpc('markers.add',input),remove:input=>rpc('markers.remove',input),update:input=>rpc('markers.update',input)},
 plan:{read:level=>rpc('plan.read',level),add:input=>rpc('plan.add',input),remove:level=>rpc('plan.remove',level),rename:input=>rpc('plan.rename',input),select:level=>rpc('plan.select',level),move:input=>rpc('plan.move',input),merge:input=>rpc('plan.merge',input),split:level=>rpc('plan.split',level),transform:input=>rpc('plan.transform',input),walls:{add:input=>rpc('plan.wallAdd',input),remove:input=>rpc('plan.wallRemove',input)}},
 view:{read:()=>rpc('view.read'),set:input=>rpc('view.set',input)},
 tour:{add:input=>rpc('tour.add',input),remove:id=>rpc('tour.remove',id),loadPanorama:input=>rpc('tour.loadPanorama',input),read:()=>rpc('tour.read'),select:id=>rpc('tour.select',id),pose:input=>rpc('tour.pose',input),update:input=>rpc('tour.update',input),connect:input=>rpc('tour.connect',input),setStart:id=>rpc('tour.start',id)},
 ui:{registerAppearance:input=>rpc('ui.appearance.register',input),removeAppearance:()=>rpc('ui.appearance.remove'),iconThemes:()=>rpc('ui.iconThemes'),iconTheme:id=>rpc('ui.iconTheme',id),tools:()=>rpc('ui.tools'),setToolVisible:(id,visible)=>rpc('ui.visibility',{id,visible}),themes:()=>rpc('ui.themes'),commands:()=>rpc('ui.commands'),execute:id=>rpc('ui.execute',id),theme:id=>rpc('ui.theme',id),scale:size=>rpc('ui.scale',size),overlay:input=>rpc('ui.overlay',input),showMessage:text=>rpc('ui.message',text),async showPanel(id,html){await rpc('ui.panel',{id,html});document.getElementById('panel').innerHTML=html}},
 archive:{list:()=>rpc('archive.list'),read:input=>rpc('archive.read',input),write:input=>rpc('archive.write',input),remove:path=>rpc('archive.remove',path),export:()=>rpc('archive.export'),download:()=>rpc('archive.download'),meta:{read:()=>rpc('archive.meta.read'),write:value=>rpc('archive.meta.write',value)}},
 keybindings:{register:input=>rpc('keybindings.register',input),unregister:id=>rpc('keybindings.unregister',id),list:()=>rpc('keybindings.list')},
 theme:{read:()=>rpc('theme.read')},
 storage:{get:key=>rpc('storage.get',key),set:(key,value)=>rpc('storage.set',{key,value})},
 assets:{read(path){if(!(path in data.files))throw new Error('Asset not found');return data.files[path]}},
 onProjectChanged(handler){listeners.add(handler);return {dispose(){listeners.delete(handler)}}}
});
window.addEventListener('message',async event=>{if(event.source!==parent||event.data?.channel!==data.channel)return;const msg=event.data;
 if(msg.type==='response'){const p=pending.get(msg.id);if(p){clearTimeout(p.timeout);pending.delete(msg.id);msg.error?p.reject(new Error(msg.error)):p.resolve(msg.result)}}
 if(msg.type==='execute'){try{const fn=handlers.get(msg.command);if(!fn)throw new Error('Command not registered');const result=await fn(msg.args);send('executed',{id:msg.id,result})}catch(error){send('executed',{id:msg.id,error:error.message})}}
 if(msg.type==='projectChanged')for(const fn of listeners)try{fn(msg.project)}catch(error){send('error',{message:error.message})}
});
const modules=new Map();function load(file){if(modules.has(file))return modules.get(file).exports;if(!(file in data.files))throw new Error('Module not found: '+file);const module={exports:{}};modules.set(file,module);const require=relative=>{if(!relative.startsWith('./'))throw new Error('Only bundled relative modules supported');const folder=file.slice(0,file.lastIndexOf('/')+1);let path=folder+relative.slice(2);if(!path.endsWith('.js'))path+='.js';if(path.split('/').includes('..'))throw new Error('Invalid module path');return load(path)};new Function('module','exports','require','palace',data.files[file])(module,module.exports,require,api);return module.exports}
(async()=>{try{const theme=await api.theme.read();document.body.style.background=theme.background;document.body.style.color=theme.foreground;extension=load(data.main);if(typeof extension.activate!=='function')throw new Error('Export activate(api)');await extension.activate(api);send('ready',{})}catch(error){send('error',{message:error.message})}})();
window.addEventListener('unload',()=>{try{extension?.deactivate?.()}catch{}});
<\/script></body></html>`;
}
function stopAddon(id){const host=addonHosts.get(id);if(!host)return;addonHosts.delete(id);clearTimeout(host.activationTimer);host.frame.remove();for(const pending of host.pending.values()){clearTimeout(pending.timer);pending.reject(new Error('Аддон отключён.'))}host.pending.clear();}
function startAddon(record){
 stopAddon(record.id);if(!addonMode||!record.enabled)return;
 const frame=document.createElement('iframe');frame.className='addon-runtime';frame.hidden=true;frame.setAttribute('sandbox','allow-scripts');frame.title=record.manifest.name;
 const host={record,frame,channel:crypto.randomUUID(),commands:new Set(),pending:new Map(),ready:false,error:null};addonHosts.set(record.id,host);
 frame.srcdoc=addonHostDocument(record,host.channel);document.querySelector('#addonPanelFrames').appendChild(frame);
 host.activationTimer=setTimeout(()=>{if(addonHosts.get(record.id)===host&&!host.ready){host.error='Активация не завершена';renderAddons()}},12000);
}
async function executeAddon(id,command){
 const host=addonHosts.get(id);if(!host?.ready||!host.commands.has(command)||host.error)throw new Error('Аддон не готов.');
 return new Promise((resolve,reject)=>{const call=crypto.randomUUID();const timer=setTimeout(()=>{host.pending.delete(call);reject(new Error('Команда не завершена за 15 секунд.'))},15000);host.pending.set(call,{resolve,reject,timer});host.frame.contentWindow.postMessage({channel:host.channel,type:'execute',command,id:call},'*')});
}
async function addonRPC(host,method,args){
 const permissions=host.record.manifest.permissions;
 if(typeof method!=='string')throw new Error('Некорректный метод.');
 const permission=method.startsWith('plan.')?(method==='plan.read'?'plan.read':method==='plan.select'?'view.control':'plan.write'):method.startsWith('tour.')?(method==='tour.read'?'tour.read':['tour.select','tour.pose'].includes(method)?'view.control':'tour.write'):method.startsWith('view.')?'view.control':method==='ui.overlay'?'ui.contribute':['ui.execute','ui.theme','ui.scale','ui.visibility'].includes(method)?'ui.control':method==='project.read'?'project.read':method.startsWith('markers.')?'markers.write':method==='metadata.write'?'metadata.write':null;
 if(permission&&!permissions.includes(permission))throw new Error('Нет разрешения: '+permission);
 const interfaces={
  'plan.read':'planRead','plan.add':'planAdd','plan.remove':'planRemove','plan.rename':'planRename','plan.select':'planSelect','plan.move':'planMove','plan.merge':'planMerge','plan.split':'planSplit','plan.transform':'planTransform','plan.wallAdd':'wallAdd','plan.wallRemove':'wallRemove',
  'markers.update':'markerUpdate','view.read':'viewRead','view.set':'viewSet','tour.read':'tourRead','tour.select':'tourSelect','tour.pose':'tourPose','tour.update':'tourUpdate','tour.connect':'tourConnect','tour.start':'tourStart','ui.tools':'uiTools','ui.themes':'uiThemes','ui.visibility':'uiVisibility','ui.commands':'uiCommands','ui.execute':'uiExecute','ui.theme':'uiTheme','ui.scale':'uiScale'
 };
 if(interfaces[method])return PalaceAPI[interfaces[method]](args);
 if(method==='ui.overlay')return addonOverlay(host,args);
 if(method==='project.read')return PalaceAPI.readProject();
 if(method==='metadata.write')return PalaceAPI.updateMetadata(args);
 if(method==='markers.add')return PalaceAPI.addMarker(args);
 if(method==='markers.remove')return PalaceAPI.removeMarker(args);
 if(method==='theme.read')return PalaceAPI.theme();
 if(method==='ui.message')return PalaceAPI.notify(args);
 if(method==='ui.panel'){
  if(!host.record.manifest.contributes?.panels?.some(p=>p.id===args?.id)||typeof args.html!=='string'||args.html.length>200000)throw new Error('Панель не объявлена в manifest.');
  for(const other of addonHosts.values())other.frame.hidden=other!==host;
  document.querySelector('#addonPanelTitle').textContent=host.record.manifest.contributes.panels.find(p=>p.id===args.id).title;
  closePersistenceModal(addonModal);showPersistenceModal(addonPanel);return true;
 }
 if(method==='storage.get'||method==='storage.set'){
  const key=method==='storage.get'?args:args?.key;if(typeof key!=='string'||key.length>100||['__proto__','constructor','prototype'].includes(key))throw new Error('Недопустимый ключ.');
  if(method==='storage.get')return host.record.storage?.[key]??null;
  if(JSON.stringify(args.value)?.length>100000)throw new Error('Значение слишком большое.');
  host.record.storage={...host.record.storage,[key]:args.value};await storeAddon(host.record);return true;
 }
 throw new Error('Неизвестный API-метод.');
}
window.addEventListener('message',async event=>{
 const host=[...addonHosts.values()].find(h=>h.frame.contentWindow===event.source&&h.channel===event.data?.channel);if(!host)return;const msg=event.data;
 if(msg.type==='ready'){host.ready=true;clearTimeout(host.activationTimer);renderAddons();return}
 if(msg.type==='error'){host.error=String(msg.message).slice(0,1000);host.ready=false;clearTimeout(host.activationTimer);renderAddons();return}
 if(msg.type==='register'){if(host.record.manifest.contributes?.commands?.some(c=>c.id===msg.id))host.commands.add(msg.id);renderAddons();return}
 if(msg.type==='unregister'){host.commands.delete(msg.id);renderAddons();return}
 if(msg.type==='executed'){const p=host.pending.get(msg.id);if(p){clearTimeout(p.timer);host.pending.delete(msg.id);msg.error?p.reject(new Error(msg.error)):p.resolve(msg.result)}return}
 if(msg.type==='rpc'){
  try{if(host.error)throw new Error('Аддон остановлен после ошибки.');const result=await addonRPC(host,msg.method,msg.args);if(addonHosts.get(host.record.id)===host)host.frame.contentWindow.postMessage({channel:host.channel,type:'response',id:msg.id,result},'*')}
  catch(error){if(addonHosts.get(host.record.id)===host)host.frame.contentWindow.postMessage({channel:host.channel,type:'response',id:msg.id,error:error.message},'*')}
 }
});
function renderAddons(){
 const list=document.querySelector('#addonList');list.replaceChildren();
 if(!addonPackages.size)list.innerHTML='<div class="addon-empty"><svg class="ic"><use href="#i-braces"/></svg><strong>Здесь появятся ваши аддоны</strong><span>Установите пакет, чтобы добавить новые возможности.</span></div>';
 const search=document.querySelector('#addonSearch').value.trim().toLowerCase();
 for(const record of addonPackages.values()){
  if(search&&!([record.id,record.manifest.name,...(record.manifest.contributes?.commands||[]).map(c=>c.title)].join(' ').toLowerCase().includes(search)))continue;
  const host=addonHosts.get(record.id),card=document.createElement('section');card.className='addon-card';card.dataset.addon=record.id;
  const title=document.createElement('h3');title.textContent=record.manifest.name+' '+record.manifest.version;
  const description=document.createElement('p');description.className='addon-description';description.textContent=record.manifest.description||record.id;
  const stateLabel=document.createElement('p');stateLabel.className='addon-state';stateLabel.dataset.state=host?.error?'error':host?.ready&&record.enabled&&addonMode?'active':'inactive';stateLabel.textContent=host?.error?'Ошибка: '+host.error:!addonMode?'Модульный режим выключен':!record.enabled?'Отключён':host?.ready?'Активен':'Активируется…';
  const actions=document.createElement('div');actions.className='persistence-actions';
  const toggle=document.createElement('button');toggle.textContent=record.enabled?'Отключить':'Включить';toggle.dataset.action='toggle';toggle.onclick=async()=>{try{record.enabled=!record.enabled;await storeAddon(record);record.enabled?startAddon(record):stopAddon(record.id);renderAddons()}catch(error){addonMessage(error.message)}};
  const remove=document.createElement('button');remove.textContent='Удалить';remove.dataset.action='remove';remove.onclick=async()=>{try{await storeAddon(record,true);stopAddon(record.id);addonPackages.delete(record.id);renderAddons()}catch(error){addonMessage(error.message)}};
  actions.append(toggle,remove);
  const commands=document.createElement('div');commands.className='addon-commands';
  for(const command of record.manifest.contributes?.commands||[]){const button=document.createElement('button');button.textContent=command.title;button.dataset.command=command.id;button.disabled=!host?.ready||!host.commands.has(command.id)||!!host.error;button.onclick=async()=>{button.disabled=true;try{await executeAddon(record.id,command.id);addonMessage('Команда выполнена: '+command.title)}catch(error){addonMessage('Ошибка команды: '+error.message)}finally{renderAddons()}};commands.appendChild(button);if(typeof registerPalaceTool==='function')registerPalaceTool('addon.command.'+command.id,command.title,button,record.id)}
  card.append(title,description,stateLabel,actions,commands);list.appendChild(card);
 }
 if(addonPackages.size&&!list.childElementCount)list.textContent='Ничего не найдено.';
}
async function installPendingAddon(){
 if(!pendingAddon)return;
 const record=pendingAddon;const old=addonPackages.get(record.id);record.storage=old?.storage||{};
 await storeAddon(record);addonPackages.set(record.id,record);startAddon(record);pendingAddon=null;document.querySelector('#addonInstallPreview').hidden=true;showAddonUploader(false);document.querySelector('#addonFile').value='';document.querySelector('#addonFileName').textContent='Файл не выбран';renderAddons();addonMessage('Аддон установлен: '+record.manifest.name);
}
addonsButton.onclick=()=>{renderAddons();showPersistenceModal(addonModal)};
document.querySelector('#addonsClose').onclick=()=>closePersistenceModal(addonModal);
document.querySelector('#addonPanelClose').onclick=()=>closePersistenceModal(addonPanel);
function showAddonUploader(visible=true){document.querySelector('#addonUploader').hidden=!visible;document.querySelector('#addonUpload').setAttribute('aria-expanded',String(visible))}
document.querySelector('#addonUpload').onclick=()=>showAddonUploader(document.querySelector('#addonUploader').hidden);
document.querySelector('#addonUploadClose').onclick=()=>{showAddonUploader(false);addonReadSequence++;pendingAddon=null;document.querySelector('#addonInstallPreview').hidden=true;document.querySelector('#addonFile').value='';document.querySelector('#addonFileName').textContent='Файл не выбран'};

document.querySelector('#addonFile').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;document.querySelector('#addonFileName').textContent=file.name;showAddonUploader();const sequence=++addonReadSequence;pendingAddon=null;document.querySelector('#addonInstallPreview').hidden=true;addonMessage('Проверка пакета…');
 try{
  const record=await readAddon(file);if(sequence!==addonReadSequence)return;pendingAddon=record;const preview=document.querySelector('#addonInstallPreview');preview.replaceChildren();preview.hidden=false;
  const text=document.createElement('p');text.textContent=pendingAddon.manifest.name+' '+pendingAddon.manifest.version+' · разрешения: '+(pendingAddon.manifest.permissions.join(', ')||'нет')+(addonPackages.has(pendingAddon.id)?' · заменит установленную версию':'');
  const accept=document.createElement('button');accept.id='addonInstall';accept.textContent='Установить';accept.onclick=()=>installPendingAddon().catch(error=>addonMessage(error.message));
  const cancel=document.createElement('button');cancel.textContent='Отмена';cancel.onclick=()=>{pendingAddon=null;preview.hidden=true};preview.append(text,accept,cancel);addonMessage('Пакет проверен. Установите аддон, чтобы запустить его.');
 }catch(error){if(sequence!==addonReadSequence)return;pendingAddon=null;document.querySelector('#addonInstallPreview').hidden=true;addonMessage('Не удалось загрузить: '+error.message)}
};
const addonDrop=document.querySelector('#addonDrop');
addonDrop.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();document.querySelector('#addonFile').click()}});
addonDrop.addEventListener('dragover',event=>{event.preventDefault();addonDrop.classList.add('drag-over')});
addonDrop.addEventListener('dragleave',()=>addonDrop.classList.remove('drag-over'));
addonDrop.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();addonDrop.classList.remove('drag-over');const files=event.dataTransfer?.files;if(files?.length)document.querySelector('#addonFile').onchange({target:{files}})});
document.querySelector('#addonMode').onchange=event=>{
 addonMode=event.target.checked;try{localStorage.setItem('palace.addonMode',String(addonMode))}catch{}
 for(const record of addonPackages.values())addonMode?startAddon(record):stopAddon(record.id);renderAddons();
};
(async()=>{try{
 addonMode=localStorage.getItem('palace.addonMode')!=='false';document.querySelector('#addonMode').checked=addonMode;
 const db=await addonStorage();const records=await idbResult(db.transaction('packages').objectStore('packages').getAll());db.close();
 for(const record of records){try{validateAddon(record.manifest,record.files);addonPackages.set(record.id,record);startAddon(record)}catch(error){addonMessage('Аддон не загружен: '+error.message)}}renderAddons();
}catch(error){addonMessage('Хранилище аддонов недоступно: '+error.message)}})();
let addonChangeTimer;
const addonTouch=touch,addonTouchSoft=touchSoft;
function notifyAddonProjectChanged(){clearTimeout(addonChangeTimer);addonChangeTimer=setTimeout(()=>{for(const host of addonHosts.values())if(host.ready&&host.record.manifest.permissions.includes('project.read'))host.frame.contentWindow.postMessage({channel:host.channel,type:'projectChanged',project:PalaceAPI.readProject()},'*')},100)}
touch=function(){addonTouch();notifyAddonProjectChanged()};touchSoft=function(){addonTouchSoft();notifyAddonProjectChanged()};

const addonRender=render;
render=function(){const result=addonRender();notifyAddonProjectChanged();return result};

document.querySelector('#addonSearch').oninput=renderAddons;
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.code==='KeyP'){event.preventDefault();event.stopImmediatePropagation();renderAddons();showPersistenceModal(addonModal);document.querySelector('#addonSearch').focus()}},true);
// Keep installation and management together in a compact, responsive dialog.
persistenceStyle.textContent+=`
#addonsModal .dialog{width:min(760px,94vw)!important;padding:22px;box-sizing:border-box;font:13px/1.5 system-ui;border-radius:12px}
#addonsModal h2{margin:0;font-size:20px}#addonsModal .addon-intro{margin:6px 0 16px;color:var(--muted)}
#addonsModal button{font:inherit;min-height:32px;padding:6px 11px;border-radius:6px;cursor:pointer}#addonsModal button:focus-visible,#addonsModal input:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.addon-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}#addonUpload,#addonInstall{background:var(--vscode-button-bg);color:var(--vscode-button-fg,#fff);border:1px solid transparent}.addon-mode{display:flex;align-items:center;gap:7px;color:var(--muted)}.addon-mode input{accent-color:var(--blue)}
#addonUploader{padding:14px;margin-bottom:14px;border:1px solid var(--line);border-radius:8px;background:var(--vscode-editor-bg,var(--panel))}#addonUploader[hidden],#addonInstallPreview[hidden]{display:none!important}.addon-upload-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}#addonUploadClose{min-height:24px;padding:0 7px;background:transparent;border:0;font-size:20px}
#addonDrop{display:flex;flex-direction:column;align-items:center;gap:5px;padding:18px;border:1px dashed var(--line);border-radius:6px;cursor:pointer;text-align:center}#addonDrop .ic{width:24px;height:24px;color:var(--blue)}#addonDrop span{font-size:11px;color:var(--muted)}#addonDrop.drag-over{border-color:var(--blue);background:color-mix(in srgb,var(--blue) 10%,transparent)}#addonFile{display:block;width:100%;box-sizing:border-box;margin-top:10px;font:inherit;color:var(--muted)}#addonFile::file-selector-button{font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:5px;background:var(--panel);color:var(--text);margin-right:8px}#addonInstallPreview{margin-top:12px;border-top:1px solid var(--line);padding-top:8px}#addonInstallPreview p{overflow-wrap:anywhere;font-size:12px}#addonInstallPreview button{margin-right:6px}
.addon-search{display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--line);border-radius:6px;background:var(--vscode-input-bg,var(--panel));margin-bottom:12px}.addon-search .ic{width:16px;height:16px;color:var(--muted)}#addonSearch{width:100%;min-width:0;border:0;background:transparent;color:var(--text);padding:9px 0;font:inherit}
#addonList{max-height:40vh;overflow:auto;padding:1px;overscroll-behavior:contain}.addon-card{display:grid;grid-template-columns:1fr auto;gap:6px 12px;padding:14px;margin:0 0 10px;border-radius:8px;background:var(--vscode-editor-bg,var(--panel))}.addon-card h3{font-size:14px;margin:0;overflow-wrap:anywhere}.addon-card .addon-description{grid-column:1;margin:0;font-size:12px;overflow-wrap:anywhere}.addon-state{grid-column:2;grid-row:1;align-self:start;margin:0;padding:2px 7px;border:1px solid var(--line);border-radius:12px;font-size:10px;color:var(--muted);max-width:180px;overflow-wrap:anywhere}.addon-state[data-state=active]{color:var(--blue);border-color:var(--blue)}.addon-state[data-state=error]{color:var(--red)}.addon-card .persistence-actions{grid-column:1/-1;margin:4px 0 0}.addon-card .addon-commands{grid-column:1/-1;border-top:1px solid var(--line);padding-top:8px}.addon-commands:empty{display:none}.addon-card [data-action=remove]{color:var(--red);margin-left:auto}
.addon-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 12px;text-align:center;color:var(--muted)}.addon-empty .ic{width:32px;height:32px}.addon-empty strong{color:var(--text);font-size:14px}.addon-empty span{font-size:12px}#addonStatus{font-size:12px;overflow-wrap:anywhere;margin-top:8px;color:var(--muted)}#addonStatus:empty{display:none}.addon-footer{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);padding-top:12px;margin-top:14px}.addon-footer span{font-size:11px;color:var(--muted)}
@media(max-width:600px){#addonsModal .dialog{padding:16px}.addon-toolbar{gap:8px}.addon-card{grid-template-columns:minmax(0,1fr)}.addon-state{grid-column:1;grid-row:auto;justify-self:start;max-width:100%}.addon-card .addon-description{grid-column:1}#addonList{max-height:35vh}}
`;

persistenceStyle.textContent+=`#addonsModal,#toolsSettings{box-sizing:border-box;height:100dvh;padding:12px!important;align-items:center!important}#addonsModal .dialog,#toolsSettings .dialog{display:block;max-height:calc(100dvh - 24px)!important}#addonUploader{position:relative}#addonFile{position:absolute;width:1px;height:1px;padding:0;margin:0;opacity:0;clip-path:inset(50%)}#addonFileName{display:block;margin-top:8px;font-size:11px;color:var(--muted);overflow-wrap:anywhere}#addonDrop:focus-visible{outline:2px solid var(--blue);outline-offset:2px}`;
