/* PALACE add-ons: local packages, capability checks and isolated extension hosts. */
'use strict';
const addonPackages=new Map(),addonHosts=new Map();
const ADDON_LIMIT=8*1024*1024;
const addonModal=persistenceModal('addonsModal','Аддоны',`
<p>Аддоны PALACE добавляют команды и панели. Файлы VSCode .vsix не поддерживаются.</p>
<div class="persistence-actions"><button id="addonUpload">Загрузить ZIP</button><input id="addonFile" type="file" accept=".zip,.palace-addon" hidden><label><input id="addonMode" type="checkbox" checked> Модульный режим</label></div>
<label for="addonSearch">Поиск аддонов и команд</label><input id="addonSearch" type="search" placeholder="Название аддона или команды" style="width:100%;padding:8px"><div id="addonInstallPreview" hidden></div><div id="addonList"></div><div id="addonStatus" role="status"></div><button id="addonsClose">Закрыть</button>`);
const addonPanel=persistenceModal('addonPanel','Панель аддона','<div id="addonPanelFrames"></div><button id="addonPanelClose">Закрыть панель</button>');
persistenceStyle.textContent+='\n.addon-card{border:1px solid var(--line);border-radius:4px;padding:12px;margin:10px 0}.addon-runtime{width:100%;height:380px;border:0;background:var(--vscode-editor-bg)}.addon-runtime[hidden]{display:none!important}#addonList .addon-description{color:var(--muted);white-space:pre-wrap}.addon-commands{display:flex;gap:6px;flex-wrap:wrap}.addon-card code{overflow-wrap:anywhere}';
const addonsButton=document.createElement('button');addonsButton.className='abtn';addonsButton.id='addonsOpen';addonsButton.type='button';addonsButton.title='Аддоны';addonsButton.setAttribute('aria-label','Аддоны');addonsButton.innerHTML='<svg class="ic"><use href="#i-braces"/></svg>';
document.querySelector('#abHotkeys').before(addonsButton);
let addonMode=true,pendingAddon=null;
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
 if(!Array.isArray(manifest.permissions)||manifest.permissions.some(p=>!['project.read','markers.write','metadata.write'].includes(p)))throw new Error('Неизвестное разрешение.');
 const commands=manifest.contributes?.commands||[],panels=manifest.contributes?.panels||[];
 const ids=new Set();
 for(const item of [...commands,...panels]){
  if(!item||typeof item.id!=='string'||!item.id.startsWith(manifest.id+'.')||ids.has(item.id)||typeof item.title!=='string'||!item.title||item.title.length>120)throw new Error('Некорректная или повторяющаяся команда/панель.');ids.add(item.id);
 }
 if(!Array.isArray(commands)||!Array.isArray(panels)||commands.length+panels.length>30)throw new Error('Не более 30 команд и панелей.');
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
  files[entry.name]=new TextDecoder('utf-8',{fatal:true}).decode(data);
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
 version:'1.0.0',
 commands:{register(id,handler){if(typeof handler!=='function')throw new Error('Command requires a handler');handlers.set(id,handler);send('register',{id});return {dispose(){handlers.delete(id)}}}},
 project:{read:()=>rpc('project.read'),updateMetadata:patch=>rpc('metadata.write',patch)},
 markers:{add:input=>rpc('markers.add',input),remove:input=>rpc('markers.remove',input)},
 ui:{showMessage:text=>rpc('ui.message',text),async showPanel(id,html){await rpc('ui.panel',{id,html});document.getElementById('panel').innerHTML=html}},
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
 const permission=method==='project.read'?'project.read':method.startsWith('markers.')?'markers.write':method==='metadata.write'?'metadata.write':null;
 if(permission&&!permissions.includes(permission))throw new Error('Нет разрешения: '+permission);
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
 if(msg.type==='register'){if(host.record.manifest.contributes?.commands?.some(c=>c.id===msg.id))host.commands.add(msg.id);return}
 if(msg.type==='executed'){const p=host.pending.get(msg.id);if(p){clearTimeout(p.timer);host.pending.delete(msg.id);msg.error?p.reject(new Error(msg.error)):p.resolve(msg.result)}return}
 if(msg.type==='rpc'){
  try{if(host.error)throw new Error('Аддон остановлен после ошибки.');const result=await addonRPC(host,msg.method,msg.args);if(addonHosts.get(host.record.id)===host)host.frame.contentWindow.postMessage({channel:host.channel,type:'response',id:msg.id,result},'*')}
  catch(error){if(addonHosts.get(host.record.id)===host)host.frame.contentWindow.postMessage({channel:host.channel,type:'response',id:msg.id,error:error.message},'*')}
 }
});
function renderAddons(){
 const list=document.querySelector('#addonList');list.replaceChildren();
 if(!addonPackages.size)list.textContent='Аддоны пока не установлены.';
 const search=document.querySelector('#addonSearch').value.trim().toLowerCase();
 for(const record of addonPackages.values()){
  if(search&&!([record.id,record.manifest.name,...(record.manifest.contributes?.commands||[]).map(c=>c.title)].join(' ').toLowerCase().includes(search)))continue;
  const host=addonHosts.get(record.id),card=document.createElement('section');card.className='addon-card';card.dataset.addon=record.id;
  const title=document.createElement('h3');title.textContent=record.manifest.name+' '+record.manifest.version;
  const description=document.createElement('p');description.className='addon-description';description.textContent=record.manifest.description||record.id;
  const stateLabel=document.createElement('p');stateLabel.textContent=host?.error?'Ошибка: '+host.error:!addonMode?'Модульный режим выключен':!record.enabled?'Отключён':host?.ready?'Активен':'Активируется…';
  const actions=document.createElement('div');actions.className='persistence-actions';
  const toggle=document.createElement('button');toggle.textContent=record.enabled?'Отключить':'Включить';toggle.dataset.action='toggle';toggle.onclick=async()=>{try{record.enabled=!record.enabled;await storeAddon(record);record.enabled?startAddon(record):stopAddon(record.id);renderAddons()}catch(error){addonMessage(error.message)}};
  const remove=document.createElement('button');remove.textContent='Удалить';remove.dataset.action='remove';remove.onclick=async()=>{try{await storeAddon(record,true);stopAddon(record.id);addonPackages.delete(record.id);renderAddons()}catch(error){addonMessage(error.message)}};
  actions.append(toggle,remove);
  const commands=document.createElement('div');commands.className='addon-commands';
  for(const command of record.manifest.contributes?.commands||[]){const button=document.createElement('button');button.textContent=command.title;button.dataset.command=command.id;button.disabled=!host?.ready||!host.commands.has(command.id)||!!host.error;button.onclick=async()=>{button.disabled=true;try{await executeAddon(record.id,command.id);addonMessage('Команда выполнена: '+command.title)}catch(error){addonMessage('Ошибка команды: '+error.message)}finally{renderAddons()}};commands.appendChild(button)}
  card.append(title,description,stateLabel,actions,commands);list.appendChild(card);
 }
 if(addonPackages.size&&!list.childElementCount)list.textContent='Ничего не найдено.';
}
async function installPendingAddon(){
 if(!pendingAddon)return;
 const record=pendingAddon;const old=addonPackages.get(record.id);record.storage=old?.storage||{};
 await storeAddon(record);addonPackages.set(record.id,record);startAddon(record);pendingAddon=null;document.querySelector('#addonInstallPreview').hidden=true;renderAddons();addonMessage('Аддон установлен: '+record.manifest.name);
}
addonsButton.onclick=()=>{renderAddons();showPersistenceModal(addonModal)};
document.querySelector('#addonsClose').onclick=()=>closePersistenceModal(addonModal);
document.querySelector('#addonPanelClose').onclick=()=>closePersistenceModal(addonPanel);
document.querySelector('#addonUpload').onclick=()=>{const input=document.querySelector('#addonFile');input.value='';input.click()};
document.querySelector('#addonFile').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;
 try{
  pendingAddon=await readAddon(file);const preview=document.querySelector('#addonInstallPreview');preview.replaceChildren();preview.hidden=false;
  const text=document.createElement('p');text.textContent=pendingAddon.manifest.name+' '+pendingAddon.manifest.version+' · разрешения: '+(pendingAddon.manifest.permissions.join(', ')||'нет')+(addonPackages.has(pendingAddon.id)?' · заменит установленную версию':'');
  const accept=document.createElement('button');accept.id='addonInstall';accept.textContent='Установить';accept.onclick=()=>installPendingAddon().catch(error=>addonMessage(error.message));
  const cancel=document.createElement('button');cancel.textContent='Отмена';cancel.onclick=()=>{pendingAddon=null;preview.hidden=true};preview.append(text,accept,cancel);addonMessage('Пакет проверен. Установите аддон, чтобы запустить его.');
 }catch(error){pendingAddon=null;document.querySelector('#addonInstallPreview').hidden=true;addonMessage('Не удалось загрузить: '+error.message)}
};
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
