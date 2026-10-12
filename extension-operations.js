/* Camera, archive and keybinding capabilities of API 1.3. */
'use strict';
const ARCHIVE_FILE_LIMIT=16*1024*1024,ARCHIVE_PATCH_LIMIT=32*1024*1024,addonKeybindings=new Map();
function requireArchive(){if(!archiveContext?.buffer)throw new Error('Сначала откройте архив.');return archiveContext}
function archivePath(path){if(typeof path!=='string'||!path||path.length>512||path.startsWith('/')||path.includes('\\')||/[\x00-\x1f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Недопустимый путь архива.');return path}
function archiveBytes(input){
 if(!input||!['text','base64'].includes(input.encoding)||typeof input.data!=='string')throw new Error('Нужны data и encoding: text или base64.');
 if(input.data.length>ARCHIVE_FILE_LIMIT*1.4)throw new Error('Файл больше 16 МБ.');
 let bytes;if(input.encoding==='text')bytes=new TextEncoder().encode(input.data);else{if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data))throw new Error('Некорректный base64.');const decoded=atob(input.data);bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0))}
 if(bytes.byteLength>ARCHIVE_FILE_LIMIT)throw new Error('Файл больше 16 МБ.');return bytes;
}
function patchArchive(path,value){
 requireEditing();const context=requireArchive();archivePath(path);
 const patches={...(context.patches||{}),[path]:value};let total=0;
 for(const patch of Object.values(patches))if(patch){total+=patch.encoding==='base64'?patch.data.length*.75:new TextEncoder().encode(patch.data).length}
 if(total>ARCHIVE_PATCH_LIMIT||Object.keys(patches).length>200)throw new Error('Не более 200 изменений и 32 МБ данных архива.');
 flushHistorySoft();context.patches=patches;touch();return true;
}
function setArchiveMeta(value){
 requireEditing();const context=requireArchive();if(value!==null&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('meta.json должен быть объектом или null.');
 const text=value===null?null:JSON.stringify(value,null,2);if(value!==null){const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('meta.json должен быть JSON-объектом.');}if(text!=null&&new TextEncoder().encode(text).length>1024*1024)throw new Error('meta.json больше 1 МБ.');
 if(context.metaText===text)return false;flushHistorySoft();context.metaText=text;touch();return true;
}
function applyArchivePatches(zip,context=archiveContext,source=true){
 if(!context)return;
 for(const [path,value]of Object.entries(context.patches||{})){
  if(source){if(value===null)zip.remove(path);else zip.file(path,value.data,{base64:value.encoding==='base64'})}
  else if(value!==null&&!zip.file(path))zip.file(path,value.data,{base64:value.encoding==='base64'});
 }
}
const operationsWriteMeta=writeArchiveMeta;writeArchiveMeta=function(zip){applyArchivePatches(zip,archiveContext,false);operationsWriteMeta(zip)};
const operationsSnapshot=snapshotState;snapshotState=function(){const snapshot=operationsSnapshot();snapshot.archiveEdits=archiveContext?{...archiveContext,patches:structuredClone(archiveContext.patches||{})}:null;return snapshot};
const operationsRestore=restoreSnapshot;restoreSnapshot=function(snapshot){if(Object.hasOwn(snapshot,'archiveEdits'))archiveContext=snapshot.archiveEdits?{...snapshot.archiveEdits,patches:structuredClone(snapshot.archiveEdits.patches||{})}:null;operationsRestore(snapshot)};
function ownCamera(id){if(typeof id!=='string'||!Object.hasOwn(state.panoramas,id))throw new Error('Камера не найдена.');return state.panoramas[id]}
async function validatedPanorama(src){apiImage(src);await loadImage(src);return {data:src,mime:src.slice(5,src.indexOf(';')),mode:'equirect'}}
async function addApiCamera(input){
 requireEditing();const floor=apiLevel(input?.level??state.active),id=input.id??crypto.randomUUID();
 if(typeof id!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(id)||['__proto__','constructor','prototype'].includes(id)||Object.hasOwn(state.panoramas,id))throw new Error('Некорректный или занятый ID камеры.');
 if(input.room!=null&&(typeof input.room!=='string'||input.room.length>1000))throw new Error('Некорректное имя камеры.');
 if(input.planPx!=null)validPoint(floor,input.planPx);
 const image=input.src?await validatedPanorama(input.src):{mode:'none'};
 requireEditing();if(!state.levels.includes(floor)||Object.hasOwn(state.panoramas,id))throw new Error('Проект изменился во время загрузки.');
 flushHistorySoft();
 if(floor.floorId==null){const previous=level();if(Object.values(state.panoramas).some(p=>p.floorId==null)){previous.floorId??='api-'+crypto.randomUUID();Object.values(state.panoramas).forEach(p=>{if(p.floorId==null)p.floorId=previous.floorId})}floor.floorId??='api-'+crypto.randomUUID()}
 state.panoramas[id]={...image,room:input.room||id,floorId:floor.floorId,planPx:input.planPx?{x:input.planPx.x,y:input.planPx.y}:null,destinations:[],navYawOffsetDeg:90};
 touch();render();return {id};
}
async function loadApiPanorama(input){
 requireEditing();const camera=ownCamera(input?.id),image=await validatedPanorama(input.src);
 requireEditing();if(state.panoramas[input.id]!==camera)throw new Error('Камера изменилась во время загрузки.');
 flushHistorySoft();Object.assign(camera,image);if(localViewer.currentId===input.id)localViewer.dispose();touch();render();return {id:input.id};
}
function registerAddonKeybinding(host,input){
 if(!input||typeof input.id!=='string'||!input.id.startsWith(host.record.id+'.')||!/^[-a-z0-9.]{3,120}$/.test(input.id))throw new Error('ID сочетания должен начинаться с ID аддона.');
 const declared=host.record.manifest.contributes?.commands?.find(c=>c.id===input.command);if(!declared||!host.commands.has(input.command))throw new Error('Сначала зарегистрируйте объявленную команду.');
 if(typeof input.key!=='string'||!/^(Ctrl\+)?(Alt\+)?(Shift\+)?(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Left|Right|Up|Down)|Space|Enter|Home|End|PageUp|PageDown)$/.test(input.key))throw new Error('Некорректное сочетание клавиш.');
 if(HOTKEYS_FIXED.some(row=>row.slice(1).includes(input.key))||['Ctrl+Shift+KeyP','Ctrl+Alt+KeyT'].includes(input.key))throw new Error('Сочетание занято системным действием.');
 const previous=addonKeybindings.get(input.id),existing=HOTKEYS.find(c=>c.id===input.id);
 if(existing&&previous?.owner!==host.record.id)throw new Error('Сочетание принадлежит другому владельцу.');
 const effective=Object.hasOwn(hkOverrides,input.id)?hkOverrides[input.id]:input.key;
 const conflict=HOTKEYS.find(c=>c.id!==input.id&&effective&&hkBinding(c.id)===effective);if(conflict)throw new Error('Сочетание занято: '+conflict.label);
 if([...addonKeybindings.values()].filter(b=>b.owner===host.record.id).length>=30&&!previous)throw new Error('Не более 30 сочетаний аддона.');
 const binding={group:host.record.manifest.name,id:input.id,label:declared.title,def:input.key,run:()=>executeAddon(host.record.id,input.command).catch(error=>notify(error.message))};
 if(existing)HOTKEYS.splice(HOTKEYS.indexOf(existing),1,binding);else HOTKEYS.push(binding);
 addonKeybindings.set(input.id,{owner:host.record.id,command:input.command,key:input.key});hkSyncTitles();if(document.querySelector('#hotkeysModal')?.classList.contains('show'))renderHotkeys();return {id:input.id,key:hkBinding(input.id)};
}
function removeAddonKeybinding(owner,id){const item=addonKeybindings.get(id);if(!item||item.owner!==owner)return false;const index=HOTKEYS.findIndex(c=>c.id===id);if(index>=0)HOTKEYS.splice(index,1);addonKeybindings.delete(id);if(hkRecording===id)hkRecording=null;if(document.querySelector('#hotkeysModal')?.classList.contains('show'))renderHotkeys();return true}
function clearAddonKeybindings(owner){for(const [id,item]of addonKeybindings)if(item.owner===owner)removeAddonKeybinding(owner,id)}
const operationsStopAddon=stopAddon;stopAddon=function(id){clearAddonKeybindings(id);operationsStopAddon(id)};
const operationsRenderAddons=renderAddons;renderAddons=function(...args){for(const host of addonHosts.values())if(host.error)clearAddonKeybindings(host.record.id);return operationsRenderAddons(...args)};
const operationsRPC=addonRPC;
addonRPC=async function(host,method,args){
 if(method.startsWith('archive.')){
  const write=['archive.write','archive.remove','archive.meta.write'].includes(method),permission=write?'archive.write':'archive.read';
  if(!host.record.manifest.permissions.includes(permission))throw new Error('Нет разрешения: '+permission);
  const context=requireArchive();
  if(method==='archive.meta.read')return context.metaText==null?null:JSON.parse(context.metaText);
  if(method==='archive.meta.write')return setArchiveMeta(args);
  if(method==='archive.write'){const path=archivePath(args?.path),bytes=archiveBytes(args);if(path==='meta.json'){const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('meta.json должен быть JSON-объектом.');return setArchiveMeta(value);}return patchArchive(path,{encoding:args.encoding,data:args.data})}
  if(method==='archive.remove'){const path=archivePath(args);return path==='meta.json'?setArchiveMeta(null):patchArchive(path,null)}
  const zip=await JSZip.loadAsync(context.buffer);applyArchivePatches(zip,context);if(context.metaText==null)zip.remove('meta.json');else zip.file('meta.json',context.metaText);
  if(method==='archive.list')return Object.values(zip.files).filter(f=>!f.dir).map(f=>({path:f.name}));
  if(method==='archive.read'){const path=archivePath(args?.path),encoding=args.encoding||'text',file=zip.file(path);if(!file)throw new Error('Файл архива не найден.');if(!['text','base64'].includes(encoding))throw new Error('Недопустимая кодировка.');if(file._data?.uncompressedSize>ARCHIVE_FILE_LIMIT)throw new Error('Файл больше 16 МБ.');const bytes=await file.async('uint8array');if(bytes.length>ARCHIVE_FILE_LIMIT)throw new Error('Файл больше 16 МБ.');return {path,encoding,data:encoding==='text'?new TextDecoder('utf-8',{fatal:true}).decode(bytes):await file.async('base64')}}
  if(method==='archive.download'){const name=context.name.replace(/([.][^.]+)$/, '-edited$1').replace(/[\\/]/g,'-');downloadBlob(await zip.generateAsync({type:'blob',compression:'DEFLATE'}),name);return {name};}
  if(method==='archive.export')return {name:context.name,encoding:'base64',data:await zip.generateAsync({type:'base64',compression:'DEFLATE'})};
 }
 if(method.startsWith('keybindings.')){if(method==='keybindings.list')return HOTKEYS.map(c=>({id:c.id,title:c.label,key:hkBinding(c.id),owner:addonKeybindings.get(c.id)?.owner||'system'}));if(!host.record.manifest.permissions.includes('keybindings.write'))throw new Error('Нет разрешения: keybindings.write');if(method==='keybindings.register')return registerAddonKeybinding(host,args);if(method==='keybindings.unregister')return removeAddonKeybinding(host.record.id,args)}
 if(['tour.add','tour.remove','tour.loadPanorama'].includes(method)){if(!host.record.manifest.permissions.includes('tour.write'))throw new Error('Нет разрешения: tour.write');if(method==='tour.add')return addApiCamera(args);if(method==='tour.loadPanorama')return loadApiPanorama(args);requireEditing();ownCamera(args);return removeEditedCamera(args)}
 return operationsRPC(host,method,args);
};
window.PalaceAPI=Object.freeze({...PalaceAPI,version:'1.3.0',tourAdd:addApiCamera,tourLoadPanorama:loadApiPanorama,tourRemove(id){requireEditing();ownCamera(id);return removeEditedCamera(id)}});

window.palaceHotkeyAllowed=(binding,event)=>!addonKeybindings.has(binding.id)||!hkTypingTarget(event.target);
