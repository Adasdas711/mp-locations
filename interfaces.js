/* Stable extension interfaces and persistent tool visibility. */
'use strict';
const palaceTools=new Map(),extensionLayers=new Map();let toolPreferences={};
try{toolPreferences=JSON.parse(localStorage.getItem('palace.tools')||'{}')}catch{}
if(!toolPreferences||typeof toolPreferences!=='object'||Array.isArray(toolPreferences))toolPreferences={};
const toolStyle=document.createElement('style');toolStyle.textContent='[data-palace-hidden="true"]{display:none!important}.tool-settings-row{display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--line)}.extension-icon{width:20px;height:20px;object-fit:contain}.extension-overlay{position:absolute;inset:0;pointer-events:none;z-index:8}.extension-overlay svg{width:100%;height:100%;overflow:hidden}';document.head.appendChild(toolStyle);
const toolsModal=persistenceModal('toolsSettings',"Interface tools","<p class=\"tools-intro\">Choose which tools appear in the interface. Restore hidden tools here.</p><div class=\"tools-filters\"><input id=\"toolsFilter\" type=\"search\" aria-label=\"Search tools\" placeholder=\"Search tools\"><select id=\"toolsCategory\" aria-label=\"Tool type\"><option value=\"all\">All tools</option><option value=\"system\">System</option><option value=\"addons\">Plugins</option></select></div><div id=\"toolsList\"></div><div class=\"persistence-actions\"><button id=\"toolsReset\">Show all</button><button id=\"toolsClose\">Close</button></div>");
const settingsButton=document.createElement('button');settingsButton.id='toolsSettingsOpen';settingsButton.className='abtn';settingsButton.type='button';settingsButton.title="Interface tools";settingsButton.setAttribute('aria-label',"Interface tools");settingsButton.innerHTML='<svg class="ic"><use href="#i-gear"/></svg>';settingsButton.dataset.short="Tools";document.querySelector('.activity').appendChild(settingsButton);
function registerPalaceTool(key,label,element,owner='system'){
 const existing=palaceTools.get(key);if(existing&&existing.element!==element)existing.element.removeAttribute('data-palace-hidden');
 element.dataset.palaceTool=key;palaceTools.set(key,{key,label,element,owner});element.dataset.palaceHidden=String(toolPreferences[key]===false);
}
function refreshSystemTools(){
 for(const el of document.querySelectorAll('.activity button,#planTools button,.top-actions button,.menubar button,.tour-toolbar button,#tourToolbarLocal button,#cameraEditorStart,#cameraEditorDelete,#tourSettingsBtn,#l3dStartFlag,#minimap button')){
  if(el===settingsButton||el.dataset.addonOwner)continue;
  const key=el.id?'system.'+el.id:el.dataset.tool?'system.tool.'+el.dataset.tool:null;if(!key)continue;
  registerPalaceTool(key,el.getAttribute('aria-label')||el.title||el.textContent.trim()||key,el);
 }
 for(const [id,label]of Object.entries({compass:"Plan rotation",markerCtl:"Locus size and wall color",minimap:"Minimap",l3dJumps:"3D transitions",floorOverlay:"Floor selection"})){const el=document.getElementById(id);if(el)registerPalaceTool('system.'+id,label,el)}
}
function setToolVisibility(key,visible){
 if(!palaceTools.has(key)||typeof visible!=='boolean')throw new Error("Tool not found.");
 const previous=toolPreferences[key];toolPreferences[key]=visible;
 try{localStorage.setItem('palace.tools',JSON.stringify(toolPreferences))}catch(error){if(previous===undefined)delete toolPreferences[key];else toolPreferences[key]=previous;throw new Error("Unable to save settings: "+error.message)}
 palaceTools.get(key).element.dataset.palaceHidden=String(!visible);renderToolSettings();return true;
}
function renderToolSettings(){
 const list=document.querySelector('#toolsList'),query=document.querySelector('#toolsFilter').value.toLowerCase();list.replaceChildren();
 for(const tool of palaceTools.values()){
  const category=document.querySelector('#toolsCategory').value;
  if(!tool.element.isConnected||category==='system'&&tool.owner!=='system'||category==='addons'&&tool.owner==='system'||!(tool.label+' '+tool.owner).toLowerCase().includes(query))continue;
  const row=document.createElement('label');row.className='tool-settings-row';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=toolPreferences[tool.key]!==false;checkbox.dataset.toolKey=tool.key;
  checkbox.onchange=()=>{try{setToolVisibility(tool.key,checkbox.checked)}catch(error){checkbox.checked=!checkbox.checked;notify(error.message)}};
  const text=document.createElement('span');text.textContent=tool.label;const owner=document.createElement('small');owner.textContent=tool.owner==='system'?"System":tool.owner;const info=document.createElement('span');info.className='tool-settings-info';info.append(text,owner);row.append(checkbox,info);list.appendChild(row);
 }
}
settingsButton.onclick=()=>{refreshSystemTools();renderToolSettings();showPersistenceModal(toolsModal)};
document.querySelector('#toolsCategory').onchange=renderToolSettings;document.querySelector('#toolsFilter').oninput=renderToolSettings;document.querySelector('#toolsClose').onclick=()=>closePersistenceModal(toolsModal);
document.querySelector('#toolsReset').onclick=()=>{try{localStorage.setItem('palace.tools','{}');toolPreferences={};for(const tool of palaceTools.values())tool.element.dataset.palaceHidden='false';renderToolSettings()}catch(error){notify("Unable to save settings: "+error.message)}};
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.altKey&&event.code==='KeyT'){event.preventDefault();settingsButton.click()}},true);
refreshSystemTools();
new MutationObserver(()=>refreshSystemTools()).observe(document.querySelector('.activity'),{childList:true});
function requireEditing(){if(!canEditPlan())throw new Error("Switch to edit mode.");}
function apiLevel(index){if(!Number.isInteger(index)||!state.levels[index])throw new Error("Floor not found.");return state.levels[index]}
function validPoint(floor,p){if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>floor.w||p.y>floor.h)throw new Error("Point must be inside the plan.")}
function apiImage(src){if(typeof src!=='string'||src.length>16*1024*1024||!/^data:image\/(png|jpeg|webp|avif);base64,[A-Za-z0-9+/=]+$/.test(src))throw new Error("A PNG/JPEG/WebP/AVIF image data URL is required.");return src}
window.PalaceAPI=Object.freeze({...PalaceAPI,version:'1.1.0',
 planRead(index=state.active){return structuredClone(apiLevel(index))},
 async planAdd(input){requireEditing();const src=apiImage(input?.src);if(input.name!=null&&typeof input.name!=='string')throw new Error("A name is required.");if(input.floorId!=null&&!['string','number'].includes(typeof input.floorId))throw new Error("Invalid floor identifier.");const projectLevels=state.levels,image=await loadImage(src);requireEditing();if(state.levels!==projectLevels)throw new Error("Project changed during loading.");const floor={name:String(input.name||"New floor").slice(0,100),named:true,src,w:image.naturalWidth,h:image.naturalHeight,floorId:input.floorId??null,markers:[],walls:[],selected:null};state.levels.push(floor);state.active=state.levels.length-1;state.zoom=1;state.rotation=0;planFitPending=true;document.querySelector("#viewport").style.transform="";touch();render();return state.active},
 planRemove(index){requireEditing();apiLevel(index);state.levels.splice(index,1);state.active=Math.max(0,Math.min(state.active,state.levels.length-1));state.zoom=1;planFitPending=true;document.querySelector("#viewport").style.transform="";touch();render();return true},
 planRename(input){requireEditing();apiLevel(input?.level);if(typeof input.name!=='string')throw new Error("A name is required.");renameLevel(input.level,input.name);return true},
 planSelect(index){if(reviewSession)throw new Error("Stop reviewing first.");apiLevel(index);selectLevel(index);return true},
 planMove(input){requireEditing();apiLevel(input?.from);apiLevel(input?.to);moveLevel(input.from,input.to);return true},
 async planMerge(input){requireEditing();apiLevel(input?.from);apiLevel(input?.to);if(input.from===input.to)throw new Error("Select two different floors.");await mergeLevels(input.from,input.to);return true},
 async planSplit(index){requireEditing();apiLevel(index);await splitLevel(index);return true},
 planTransform(input){requireEditing();if(!input||!Number.isFinite(input.rotation))throw new Error("Invalid angle.");applyRotation(input.rotation);return true},
 markerUpdate(input){requireEditing();const floor=apiLevel(input?.level),marker=floor.markers[input.index];if(!Number.isInteger(input.index)||!marker)throw new Error("Locus not found.");const patch=input.patch;if(!patch||typeof patch!=='object')throw new Error("Locus fields are required.");for(const key of Object.keys(patch))if(!['x','y','note','localPano'].includes(key))throw new Error("Invalid locus field.");validPoint(floor,{...marker,...patch});if(patch.note!=null&&(typeof patch.note!=='string'||patch.note.length>50000))throw new Error("Invalid note.");if(patch.localPano!=null&&!state.panoramas[patch.localPano])throw new Error("Camera not found.");Object.assign(marker,patch);touch();render();return true},
 wallAdd(input){requireEditing();const floor=apiLevel(input?.level);validPoint(floor,{x:input.x1,y:input.y1});validPoint(floor,{x:input.x2,y:input.y2});floor.walls||=[];floor.walls.push({x1:input.x1,y1:input.y1,x2:input.x2,y2:input.y2});touch();render();return floor.walls.length-1},
 wallRemove(input){requireEditing();const floor=apiLevel(input?.level);if(!Number.isInteger(input.index)||!floor.walls?.[input.index])throw new Error("Wall not found.");floor.walls.splice(input.index,1);touch();render();return true},
 viewRead(){return {layout:state.layout,planView,zoom:state.zoom,rotation:state.rotation,activeCamera:activeLocalPano,yaw:localViewer.yaw,pitch:localViewer.pitch,fov:localViewer.fov}},
 async viewSet(input){if(reviewSession)throw new Error("Stop reviewing first.");if(!input||typeof input!=='object')throw new Error("View parameters are required.");if(input.layout!=null&&!['plan','tour','split','split-rev'].includes(input.layout))throw new Error("Unknown view.");if(input.planView!=null&&!['2d','3d'].includes(input.planView))throw new Error("Unknown plan mode.");if(input.zoom!=null&&(!Number.isFinite(input.zoom)||input.zoom<=0||input.zoom>20))throw new Error("Invalid zoom.");if(input.layout){state.layout=input.layout;applyLayout()}if(input.planView)await setPlanView(input.planView);if(input.zoom!=null)applyZoom(input.zoom);return this.viewRead()},
 tourRead(){return structuredClone(state.panoramas)},
 tourSelect(id){if(reviewSession)throw new Error("Stop reviewing first.");if(!state.panoramas[id])throw new Error("Camera not found.");state.layout='tour';applyLayout();setActiveLocalPano(id,false);return true},
 tourPose(input){if(reviewSession)throw new Error("Stop reviewing first.");if(!localViewer.renderer)throw new Error("Open the 3D view first.");for(const key of Object.keys(input||{}))if(!['yaw','pitch','fov'].includes(key)||!Number.isFinite(input[key]))throw new Error("Invalid camera view.");if(input.yaw!=null){localViewer.yaw=((input.yaw%360)+360)%360;localViewer.pendingYaw={id:localViewer.currentId,yaw:localViewer.yaw}}localViewer.velYaw=0;localViewer.velPitch=0;if(input.pitch!=null)localViewer.pitch=Math.max(-85,Math.min(85,input.pitch));if(input.fov!=null){localViewer.fov=Math.max(30,Math.min(150,input.fov));localViewer.fovTarget=localViewer.fov;localViewer.camera.fov=localViewer.fov;localViewer.camera.updateProjectionMatrix()}localViewer.requestRender();return this.viewRead()},
 tourUpdate(input){requireEditing();const camera=state.panoramas[input?.id];if(!camera)throw new Error("Camera not found.");const patch=input.patch;if(!patch||typeof patch!=='object')throw new Error("Camera fields are required.");for(const key of Object.keys(patch))if(!['room','hidden','headingDeg','navYawOffsetDeg','planPx'].includes(key))throw new Error("Invalid camera field.");if(patch.room!=null&&(typeof patch.room!=='string'||patch.room.length>1000))throw new Error("Invalid camera name.");for(const key of ['headingDeg','navYawOffsetDeg'])if(patch[key]!=null&&!Number.isFinite(patch[key]))throw new Error("Invalid angle.");if(patch.hidden!=null&&typeof patch.hidden!=='boolean')throw new Error("Invalid visibility.");if(patch.planPx)validPoint(levelOfPanorama(input.id),patch.planPx);Object.assign(camera,structuredClone(patch));touch();render();return true},
 tourConnect(input){requireEditing();if(typeof input?.add!=='boolean')throw new Error("Specify add.");return changeCameraTransition(input.from,input.to,input.add)},
 tourStart(id){requireEditing();if(id!==null&&!state.panoramas[id])throw new Error("Camera not found.");setStartPano(id);return true},
 uiVisibility(input){return setToolVisibility(input?.id,input?.visible)},
 uiThemes(){return window.PALACE_THEMES.map(theme=>({id:theme.id,title:theme.name}))},
 uiTools(){return [...palaceTools.values()].filter(t=>t.element.isConnected).map(t=>({id:t.key,title:t.label,owner:t.owner,visible:toolPreferences[t.key]!==false}))},
 uiExecute(id){const command=HOTKEYS.find(c=>c.id===id);if(!command)throw new Error("Command not found.");if(reviewSession&&!['review.start','file.save','hotkeys.open'].includes(id))throw new Error("Stop reviewing first.");command.run();return true},
 uiCommands(){return HOTKEYS.map(c=>({id:c.id,title:c.label}))},
 uiTheme(id){if(typeof id!=='string'||!window.PALACE_THEMES.some(theme=>theme.id===id))throw new Error("Theme not found.");applyTheme(id);return this.theme()},
 uiScale(size){if(![0,1,2].includes(size))throw new Error("UI size must be 0, 1 or 2.");PALACE_UI.setSize(size);return size}
});
const extensionSlots={activity:'.activity',plan:'#planTools',tour:'#tourToolbarLocal',header:'.top-actions',status:'.status'};
function removeAddonTools(id,overlays=true){for(const [key,tool]of palaceTools)if(tool.owner===id&&(overlays||!key.startsWith('addon.layer.')&&!key.startsWith('addon.command.'))){tool.element.remove();palaceTools.delete(key)}if(overlays)for(const [key,definition]of extensionLayers)if(definition.host.record.id===id)extensionLayers.delete(key);if(overlays)document.querySelectorAll('[data-overlay-owner]').forEach(el=>{if(el.dataset.overlayOwner===id)el.remove()});if(toolsModal.classList.contains('show'))renderToolSettings()}
function addonIcon(host,icon){
 if(typeof icon==='string'&&typeof host.record.files[icon]==='string'&&(/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(host.record.files[icon].trim())||/^data:image\/(png|jpeg|webp|avif);base64,/.test(host.record.files[icon]))){const img=document.createElement('img');img.className='extension-icon';img.alt='';img.src=host.record.files[icon].startsWith('data:')?host.record.files[icon]:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(host.record.files[icon]);return img}
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('ic');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href','#i-'+(typeof icon==='string'&&document.getElementById('i-'+icon)?icon:'braces'));svg.appendChild(use);return svg;
}
function syncAddonTools(host){
 removeAddonTools(host.record.id,false);if(!host.ready||host.error||!host.record.manifest.permissions.includes('ui.contribute'))return;
 const contributions=host.record.manifest.contributes||{};
 for(const [kind,items]of [['activity',contributions.activityBar||[]],['toolbar',contributions.toolbars||[]]])for(const item of items){
  const location=kind==='activity'?'activity':item.location,parent=document.querySelector(extensionSlots[location]);if(!parent)continue;
  const button=document.createElement('button');button.type='button';button.className=location==='activity'?'abtn':location==='plan'?'tool':'';button.title=item.title;button.setAttribute('aria-label',item.title);button.dataset.addonOwner=host.record.id;button.dataset.short=item.title;
  button.appendChild(addonIcon(host,item.icon));if(location==='header'||location==='tour'||location==='status')button.appendChild(document.createTextNode(item.title));
  button.disabled=!host.commands.has(item.command);button.onclick=()=>executeAddon(host.record.id,item.command).catch(error=>addonMessage(error.message));parent.appendChild(button);
  registerPalaceTool('addon.'+item.id,item.title,button,host.record.id);
 }
 if(toolsModal.classList.contains('show'))renderToolSettings();
}
function addonOverlay(host,input){
 if(!input||!['plan','tour'].includes(input.location)||typeof input.id!=='string'||!input.id.startsWith(host.record.id+'.'))throw new Error("Invalid overlay.");
 const key=host.record.id+'|'+input.id;let layer=[...document.querySelectorAll('[data-overlay-id]')].find(el=>el.dataset.overlayId===key);
 if(input.remove){extensionLayers.delete(key);layer?.remove();palaceTools.delete('addon.layer.'+input.id);return true}
 if(!Array.isArray(input.shapes)||input.shapes.length>500)throw new Error("A maximum of 500 shapes is allowed.");
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 const floor=level();const width=input.location==='plan'?floor?.w:1000,height=input.location==='plan'?floor?.h:1000;if(!width||!height)throw new Error("No plan.");svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
 for(const shape of input.shapes){if(!['circle','rect','line','text'].includes(shape.type))throw new Error("Unknown shape.");const el=document.createElementNS(svg.namespaceURI,shape.type);for(const [key,value]of Object.entries(shape)){if(key==='type')continue;if(key==='text'){if(shape.type!=='text'||typeof value!=='string'||value.length>2000)throw new Error("Invalid text.");el.textContent=value;continue}if(!['x','y','x1','y1','x2','y2','width','height','r','cx','cy','stroke','fill','stroke-width','opacity','font-size'].includes(key))throw new Error("Invalid shape property.");if(['stroke','fill'].includes(key)){if(typeof value!=='string'||!(/^(#[0-9a-f]{3,8}|none|[a-z]{1,20})$/i.test(value)))throw new Error("Invalid color.")}else if(!Number.isFinite(value)||Math.abs(value)>100000)throw new Error("Invalid coordinate.");el.setAttribute(key,String(value))}svg.appendChild(el)}
 if(!layer){layer=document.createElement('div');layer.className='extension-overlay';layer.dataset.overlayId=key;layer.dataset.overlayOwner=host.record.id;document.querySelector(input.location==='plan'?'#plan':'#local3d').appendChild(layer)}layer.replaceChildren(svg);extensionLayers.set(key,{host,input:structuredClone(input),level:state.active});registerPalaceTool('addon.layer.'+input.id,input.title||("Overlay "+input.id),layer,host.record.id);return true;
}
const interfaceRenderAddons=renderAddons;renderAddons=function(){interfaceRenderAddons();for(const host of addonHosts.values())syncAddonTools(host)};
const interfaceStopAddon=stopAddon;stopAddon=function(id){removeAddonTools(id);interfaceStopAddon(id)};

new MutationObserver(()=>{
 for(const [key,definition]of extensionLayers){
  if(definition.input.location!=='plan')continue;
  const layer=[...document.querySelectorAll('[data-overlay-id]')].find(el=>el.dataset.overlayId===key);
  if(definition.level!==state.active){layer?.remove();continue}
  if(!layer&&addonHosts.get(definition.host.record.id)===definition.host){try{addonOverlay(definition.host,definition.input)}catch{}}
 }
}).observe(document.querySelector('#plan'),{childList:true});

toolStyle.textContent+=`#toolsSettings .dialog{width:min(760px,94vw)!important;padding:22px;box-sizing:border-box;border-radius:12px;font:13px/1.5 system-ui}#toolsSettings h2{font-size:20px;margin:0}.tools-intro{color:var(--muted);margin:6px 0 16px}.tools-filters{display:flex;gap:8px;margin-bottom:12px}.tools-filters input{flex:1;min-width:0}.tools-filters input,.tools-filters select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--vscode-input-bg,var(--panel));color:var(--text)}#toolsList{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:50vh;overflow:auto;overscroll-behavior:contain;padding:1px}.tool-settings-row{border:1px solid var(--line);border-radius:6px;margin:0;padding:9px;min-width:0;background:var(--vscode-editor-bg,var(--panel));cursor:pointer}.tool-settings-row:focus-within{outline:1px solid var(--blue)}.tool-settings-row input{accent-color:var(--blue);flex:none}.tool-settings-info{display:flex;flex-direction:column;min-width:0;overflow-wrap:anywhere}.tool-settings-info small{color:var(--muted);font-size:10px}#toolsSettings .persistence-actions{border-top:1px solid var(--line);padding-top:12px;margin:14px 0 0;justify-content:space-between}#toolsSettings button{font:inherit;padding:6px 11px;border-radius:6px}@media(max-width:600px){#toolsSettings .dialog{padding:16px}#toolsList{grid-template-columns:1fr}.tools-filters{flex-direction:column}}`;
