/* One settings window: navigation on the left, existing live controls on the right. */
'use strict';
const settingsModal=persistenceModal('settingsModal',"Settings",`<button id="settingsClose" type="button" aria-label="Close settings">×</button><div class="settings-layout"><aside class="settings-sidebar"><input id="settingsSearch" type="search" placeholder="Search settings…" aria-label="Search settings"><nav id="settingsNav" aria-label="Settings sections"></nav></aside><main class="settings-content" id="settingsContent"></main></div>`);
const settingsLights=document.createElement('span');settingsLights.className='settings-window-lights';settingsLights.setAttribute('aria-hidden','true');settingsLights.innerHTML='<i></i><i></i><i></i>';document.querySelector('#settingsModalTitle').prepend(settingsLights);
const settingsNav=document.querySelector('#settingsNav'),settingsContent=document.querySelector('#settingsContent');
const settingsPages=new Map();
const settingsSections = new Map();
for (const title of ['Options', 'Core plugins', 'Community plugins']) {
 const section=document.createElement('section');section.className='settings-nav-group';
 const heading=document.createElement('h3');heading.textContent=title;
 const items=document.createElement('div');items.className='settings-nav-items';
 section.append(heading,items);settingsNav.append(section);settingsSections.set(title,items);
}
function arrangeSettingsNavigation(){
 const order=['app','appearance','tools','editor','files','hotkeys','core','addons'];
 for(const id of order){const page=settingsPages.get(id);if(page)settingsSections.get('Options').append(page.button)}
 for(const id of ['canvas','cameras','viewer','minimap','history','command-palette','workspace-presets']){const page=settingsPages.get(id);if(page)settingsSections.get('Core plugins').append(page.button)}
}

function settingsPage(id,title,icon,element,button){
 const dialog=element.querySelector(':scope > .dialog');if(dialog){dialog.removeAttribute('role');dialog.removeAttribute('aria-modal');dialog.removeAttribute('aria-labelledby')}
 const heading=element.querySelector('h2');if(heading){heading.id=heading.id||'settings-'+id+'-title';element.setAttribute('role','region');element.setAttribute('aria-labelledby',heading.id)}
 element.classList.remove('modal','show');element.classList.add('settings-pane');element.hidden=true;element.dataset.settingsPage=id;settingsContent.append(element);
 button=button||document.createElement('button');button.type='button';button.className='settings-nav-item';button.removeAttribute('data-palace-hidden');button.removeAttribute('data-palace-tool');button.dataset.settingsPage=id;
 button.innerHTML='<svg class="ic"><use href="#i-'+icon+'"/></svg><span></span>';button.querySelector('span').textContent=title;button.title=title;button.setAttribute('aria-label',title);button.onclick=()=>openSettingsPage(id);settingsNav.append(button);
 settingsPages.set(id,{title,element,button});arrangeSettingsNavigation();
}
function settingsRow(title, description, control){
 return `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-title">${title}</div><div class="settings-row-description">${description}</div></div><div class="settings-row-control">${control}</div></div>`;
}
function newSettingsPane(title,content){const pane=document.createElement('section');pane.innerHTML=`<div class="dialog"><h2>${title}</h2>${content}</div>`;return pane}
const appearanceSettings=newSettingsPane('Appearance',`<div class="settings-card">
 ${settingsRow('Color theme','Choose the colors used throughout the app.','<select id="settingsTheme" aria-label="Color theme"></select><button id="settingsManageThemes" type="button">Manage</button>')}
 ${settingsRow('Accent color','Choose the accent used for selections and interface controls.','<button id="settingsAccentReset" type="button" aria-label="Reset accent color">↺</button><input id="settingsAccent" type="color" aria-label="Accent color">')}
 ${settingsRow('Icon set','Choose the icons provided by your installed plugins.','<select id="settingsIcons" aria-label="Icon set"></select>')}
 ${settingsRow('Interface size','Adjust the size of icons and text.','<select id="settingsSize" aria-label="Interface size"><option value="0">Small</option><option value="1">Medium</option><option value="2">Large</option></select>')}
 </div><h3 class="settings-section-title">Font</h3><div class="settings-card">
 ${settingsRow('Interface font','Use the theme font or a font available on your device.','<select id="settingsFont" aria-label="Interface font"><option value="">Theme default</option><option value="system-ui, sans-serif">System</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Georgia</option><option value="ui-monospace, monospace">Monospace</option></select>')}
 </div>`);
let settingsAppearancePreferences={};
try{const saved=JSON.parse(localStorage.getItem('palace.settings.appearance')||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))settingsAppearancePreferences=saved}catch{}
function applySettingsAppearance(){
 const root=document.documentElement.style,accent=settingsAppearancePreferences.accent;
 for(const token of ['--t-accent','--t-focus','--blue','--vscode-focus','--vscode-activity-badge']){
  if(typeof accent==='string'&&/^#[0-9a-f]{6}$/i.test(accent))root.setProperty(token,accent);else root.removeProperty(token);
 }
 const font=settingsAppearancePreferences.font;
 if(['system-ui, sans-serif','Arial, sans-serif','Georgia, serif','ui-monospace, monospace'].includes(font))root.setProperty('--t-font-ui',font);else root.removeProperty('--t-font-ui');
}
function saveSettingsAppearance(){try{localStorage.setItem('palace.settings.appearance',JSON.stringify(settingsAppearancePreferences));applySettingsAppearance()}catch(error){notify('Unable to save appearance: '+error.message)}}
applySettingsAppearance();
settingsPage('appearance',"Appearance",'contrast',appearanceSettings);
settingsPage('tools','Interface','window',toolsModal);toolsModal.querySelector('h2').textContent='Interface';
settingsPage('hotkeys',"Hotkeys",'keyboard',document.querySelector('#hotkeysModal'),document.querySelector('#abHotkeys'));
settingsPage('addons','Community plugins','braces',addonModal,addonsButton);
const editorSettings=newSettingsPane('Editor',`<div class="settings-card">
 ${settingsRow('Marker size','Set the locus size in the current palace.','<input id="settingsMarkerSize" type="number" min="20" max="100" aria-label="Marker size">')}
 ${settingsRow('Floor plan background','Use the original plan or adapt it to the current theme.','<select id="settingsFloorMode" aria-label="Floor plan background"><option value="off">Original</option><option value="dark">Theme background</option></select>')}
 ${settingsRow('Wall color','Set the wall color for the current theme.','<input id="settingsWalls" type="color" aria-label="Wall color"><button id="settingsWallsReset" type="button" aria-label="Reset wall color">↺</button>')}
 </div>`);
settingsPage('editor','Editor','edit',editorSettings);
const filesSettings=newSettingsPane('Files and links',`<div class="settings-card">
 ${settingsRow('Palace files','Open, save or export a palace and its panoramas.','<button type="button" id="settingsFiles">Open file menu</button>')}
 ${settingsRow('Archive metadata','View and edit meta.json in the current .3dview or .mpalace archive.','<button type="button" id="settingsMetadata">Edit metadata</button>')}
 ${settingsRow('Local snapshots','Manage versions stored in this browser. Export important palaces to a file.','<button type="button" id="settingsRecovery">Manage</button>')}
 </div>`);
settingsPage('files','Files and links','folder',filesSettings);
const coreDefinitions={
 core:{title:'Core plugins',icon:'folder',keys:null},
 canvas:{title:'Canvas',icon:'plan',keys:['system.abPlan','system.floorOverlay','system.compass','system.planDarkFloor','system.markerCtl']},
 cameras:{title:'Camera editor',icon:'camera-edit',keys:['system.tool.camera']},
 viewer:{title:'3D viewer',icon:'cube',keys:['system.abTour','system.l3dJumps','system.tourSettingsBtn']},
 minimap:{title:'Minimap',icon:'layers',keys:['system.minimap']}
};
for(const [id,definition]of Object.entries(coreDefinitions))settingsPage(id,definition.title,definition.icon,newSettingsPane(definition.title,'<p class="settings-description">Choose which built-in tools appear in your workspace. These preferences are saved in this browser.</p><div class="settings-card settings-core-list"></div>'));
function renderSettingsCore(id){
 refreshSystemTools();const definition=coreDefinitions[id],list=settingsPages.get(id).element.querySelector('.settings-core-list');list.replaceChildren();
 for(const tool of palaceTools.values()){
  if(tool.owner!=='system'||!tool.element.isConnected||definition.keys&&!definition.keys.includes(tool.key))continue;
  const row=document.createElement('label');row.className='settings-row';
  const info=document.createElement('span');info.className='settings-row-info';
  const title=document.createElement('span');title.className='settings-row-title';title.textContent=tool.label;
  const description=document.createElement('span');description.className='settings-row-description';description.textContent='Show this tool in the workspace.';info.append(title,description);
  const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.className='settings-switch';checkbox.checked=toolPreferences[tool.key]!==false;checkbox.dataset.coreTool=tool.key;
  checkbox.onchange=()=>{try{setToolVisibility(tool.key,checkbox.checked)}catch(error){checkbox.checked=!checkbox.checked;notify(error.message)}};row.append(info,checkbox);list.append(row);
 }
 if(!list.children.length){const text=document.createElement('p');text.className='settings-description';text.textContent='This tool becomes available when a palace is open.';list.append(text)}
}
function refreshSettingsPluginNavigation(){
 const list=settingsSections.get('Community plugins');list.replaceChildren();
 for(const record of addonPackages.values()){
  const button=document.createElement('button');button.type='button';button.className='settings-nav-item settings-plugin-item';button.dataset.pluginId=record.id;
  const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.classList.add('ic');const use=document.createElementNS(icon.namespaceURI,'use');use.setAttribute('href','#i-braces');icon.append(use);
  const name=document.createElement('span');name.textContent=record.manifest.name;button.append(icon,name);button.onclick=()=>{openSettingsPage('addons');document.querySelector('#addonSearch').value=record.id;renderAddons()};list.append(button);
 }
 if(!list.children.length){const empty=document.createElement('span');empty.className='settings-nav-empty';empty.textContent='No installed plugins';list.append(empty)}
}
const settingsRenderAddons=renderAddons;renderAddons=function(...args){const result=settingsRenderAddons(...args);refreshSettingsPluginNavigation();return result};refreshSettingsPluginNavigation();
for(const key of ['system.addonsOpen','system.abHotkeys'])palaceTools.delete(key);
// File actions remain available through File, rather than occupying the sidebar.
const fileSettingsActions=document.createElement('div');fileSettingsActions.className='persistence-actions';fileSettingsActions.id='fileSettingsActions';
const createPalaceButton=document.querySelector('#newBtn');createPalaceButton.className='';createPalaceButton.textContent="New palace";createPalaceButton.removeAttribute('data-palace-hidden');createPalaceButton.removeAttribute('data-palace-tool');palaceTools.delete('system.newBtn');
createPalaceButton.onclick=()=>{document.querySelector('#saveModal').classList.remove('show');newPalace()};
const fileAddPlans=document.createElement('button');fileAddPlans.id='fileAddPlans';fileAddPlans.type='button';fileAddPlans.textContent="Add plans";fileAddPlans.onclick=()=>{if(!canEditPlan())return;document.querySelector('#saveModal').classList.remove('show');openPlansModal()};
fileSettingsActions.append(createPalaceButton,fileAddPlans);document.querySelector('#saveModal .dlg-head').after(fileSettingsActions);
const settingsApplyMode=applyMode;applyMode=function(...args){const result=settingsApplyMode(...args);fileAddPlans.disabled=!canEditPlan();return result};fileAddPlans.disabled=!canEditPlan();
settingsButton.title="Settings";settingsButton.setAttribute('aria-label',"Settings");settingsButton.dataset.short="Settings";
const settingsOriginalShow=showPersistenceModal,settingsOriginalClose=closePersistenceModal;
showPersistenceModal=function(modal){const page=modal?.dataset.settingsPage;if(page)return openSettingsPage(page);return settingsOriginalShow(modal)};
closePersistenceModal=function(modal){if(modal===settingsModal||modal?.dataset.settingsPage)return closeSettings();return settingsOriginalClose(modal)};
function syncSettingsAppearance(){
 const select=document.querySelector('#settingsTheme');select.replaceChildren();for(const theme of PALACE_THEMES)select.add(new Option(theme.name,theme.id));select.value=getTheme();document.querySelector('#settingsSize').value=String(window.PALACE_UI?.size??1);
 const icons=document.querySelector('#settingsIcons');icons.replaceChildren();for(const pack of palaceIconThemes.values())icons.add(new Option(pack.title,pack.id));icons.value=activeIconTheme;
 document.querySelector('#settingsAccent').value=settingsAppearancePreferences.accent||getThemeDef().ui.accent;
 document.querySelector('#settingsFont').value=settingsAppearancePreferences.font||'';
}
function openSettingsPage(id='tools'){
 const selected=settingsPages.get(id);if(!selected)return;
 for(const [key,page]of settingsPages){page.element.hidden=key!==id;page.element.classList.toggle('show',key===id);page.button.classList.toggle('active',key===id);page.button.setAttribute('aria-current',key===id?'page':'false')}
 settingsModal.dataset.page=id;
 if(id==='tools'){refreshSystemTools();renderToolSettings()}
 if(id==='addons')renderAddons();
 if(id==='appearance')syncSettingsAppearance();
 if(id==='hotkeys'){hkRecording=null;renderHotkeys()}
 if(coreDefinitions[id])renderSettingsCore(id);
 if(id==='editor'){document.querySelector('#settingsMarkerSize').value=markerSize();document.querySelector('#settingsMarkerSize').disabled=!canEditPlan();document.querySelector('#settingsFloorMode').value=floorMode();document.querySelector('#settingsWalls').value=themeWallColor()}
 if(settingsModal.hidden)settingsOriginalShow(settingsModal);
}
function closeSettings(){hkRecording=null;document.querySelector('#settingsSearch').value='';for(const page of settingsPages.values())page.button.hidden=false;settingsOriginalClose(settingsModal);for(const page of settingsPages.values())page.element.classList.remove('show')}
settingsButton.onclick=()=>openSettingsPage();document.querySelector('#settingsClose').onclick=closeSettings;
// Embedded sections keep their controls; the outer window owns keyboard focus.
settingsModal.addEventListener('keydown',event=>{
 if(event.key!=='Tab')return;event.stopPropagation();
 const controls=[...settingsModal.querySelectorAll('button:not(:disabled),input:not(:disabled):not([tabindex="-1"]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.offsetParent);
 const first=controls[0],last=controls[controls.length-1];if(!first)return;
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
},true);

for(const id of ['addonsClose','toolsClose','hkClose','hkCloseX']){const el=document.getElementById(id);if(el)el.onclick=closeSettings}
openHotkeys=function(){setVal('#hkFilter','');setText('#hkNote','');openSettingsPage('hotkeys');document.querySelector('#hkFilter').focus()};closeHotkeys=closeSettings;
document.querySelector('#hotkeysHint').onclick=openHotkeys;
document.querySelector('#settingsTheme').onchange=event=>{applyTheme(event.target.value);syncSettingsAppearance()};
document.querySelector('#settingsSize').onchange=event=>window.PALACE_UI?.setSize(Number(event.target.value));
document.querySelector('#settingsManageThemes').onclick=()=>openSettingsPage('addons');
document.querySelector('#settingsAccent').oninput=event=>{settingsAppearancePreferences.accent=event.target.value;saveSettingsAppearance()};
document.querySelector('#settingsAccentReset').onclick=()=>{delete settingsAppearancePreferences.accent;saveSettingsAppearance();syncSettingsAppearance()};
document.querySelector('#settingsFont').onchange=event=>{settingsAppearancePreferences.font=event.target.value;saveSettingsAppearance()};
document.querySelector('#settingsIcons').onchange=event=>{try{setInterfaceIconTheme(event.target.value)}catch(error){notify(error.message)}};
document.querySelector('#settingsMarkerSize').onchange=event=>{if(!canEditPlan())return;const value=Number(event.target.value);if(!Number.isFinite(value)||value<20||value>100){event.target.value=markerSize();return}const control=document.querySelector('#markerSize');control.value=String(value);control.dispatchEvent(new Event('input'));control.dispatchEvent(new Event('change'))};
document.querySelector('#settingsFloorMode').onchange=event=>setFloorMode(event.target.value);
document.querySelector('#settingsWalls').oninput=event=>{const control=document.querySelector('#wallColor');control.value=event.target.value;control.dispatchEvent(new Event('input'))};
document.querySelector('#settingsWallsReset').onclick=()=>{document.querySelector('#wallColorReset').click();document.querySelector('#settingsWalls').value=themeWallColor()};
document.querySelector('#settingsFiles').onclick=()=>{closeSettings();openSaveModal()};
document.querySelector('#settingsMetadata').onclick=()=>{closeSettings();document.querySelector('#metaOpen').click()};
document.querySelector('#settingsRecovery').onclick=()=>{closeSettings();document.querySelector('#recoveryOpen').click()};
document.querySelector('#settingsSearch').oninput=event=>{
 const query=event.target.value.trim().toLowerCase(),matches=[];
 const extra={editor:'marker size floor plan background walls',files:'files links archives metadata snapshots autosaves',core:'built-in features',canvas:'canvas rotation plan',cameras:'camera connections editing',viewer:'panoramas tour 3d',minimap:'minimap navigation',app:"install PWA offline application home screen",appearance:"theme color interface size "+PALACE_THEMES.map(t=>t.name).join(' '),tools:"system tools "+[...palaceTools.values()].map(t=>t.label).join(' '),hotkeys:"keyboard shortcuts "+HOTKEYS.map(k=>k.label).join(' '),addons:"extensions installation "+[...addonPackages.values()].map(p=>p.manifest.name).join(' ')};
 for(const [id,page]of settingsPages){const matched=!query||(page.title+' '+(extra[id]||'')).toLowerCase().includes(query);page.button.hidden=!matched;if(matched)matches.push(id)}
 if(!query){document.querySelector('#toolsFilter').value='';document.querySelector('#addonSearch').value='';document.querySelector('#hkFilter').value='';renderToolSettings();renderAddons();renderHotkeys()}
 if(query&&matches.length===1){const id=matches[0];openSettingsPage(id);if(id==='tools'){document.querySelector('#toolsFilter').value=[...palaceTools.values()].some(t=>(t.label+' '+t.owner).toLowerCase().includes(query))?query:'';renderToolSettings()}if(id==='addons'){document.querySelector('#addonSearch').value=[...addonPackages.values()].some(p=>(p.id+' '+p.manifest.name+' '+(p.manifest.contributes?.commands||[]).map(c=>c.title).join(' ')).toLowerCase().includes(query))?query:'';renderAddons()}if(id==='hotkeys'){document.querySelector('#hkFilter').value=HOTKEYS.some(k=>k.label.toLowerCase().includes(query))?query:'';renderHotkeys()}}
};
const settingsStyle=document.createElement('style');settingsStyle.textContent=`
#settingsModal{padding:16px!important;align-items:center!important;box-sizing:border-box}#settingsModal>.dialog{position:relative;width:min(1080px,96vw)!important;height:min(760px,92dvh);max-height:92dvh!important;padding:0!important;display:flex;flex-direction:column;overflow:hidden;border-radius:12px!important;font:13px/1.5 system-ui;box-sizing:border-box}#settingsModalTitle{margin:0;padding:16px 22px;border-bottom:1px solid var(--line);font-size:17px;flex:none}#settingsClose{position:absolute;right:12px;top:9px;background:transparent;border:0;font:24px system-ui;color:var(--muted);cursor:pointer}
.settings-layout{display:flex;flex:1;min-height:0}.settings-sidebar{width:220px;flex:none;padding:18px 12px;background:var(--vscode-editor-bg,var(--panel));border-right:1px solid var(--line);overflow:auto;box-sizing:border-box}#settingsSearch{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line);border-radius:18px;background:var(--vscode-input-bg,var(--panel));color:var(--text);font:inherit;margin-bottom:20px}#settingsNav{display:flex;flex-direction:column;gap:4px}#settingsModal #settingsNav .settings-nav-item{display:flex!important;align-items:center;gap:10px;min-height:36px;padding:8px 10px!important;border:0!important;border-radius:6px;background:transparent!important;color:var(--text);text-align:left;font:inherit;cursor:pointer}#settingsModal #settingsNav .settings-nav-item[hidden]{display:none!important}.settings-nav-item .ic{width:18px;height:18px;flex:none}.settings-nav-item.active{background:var(--vscode-input-bg,var(--line))!important}.settings-nav-item:focus-visible{outline:2px solid var(--blue)}.settings-content{flex:1;min-width:0;overflow:auto;padding:28px 32px;box-sizing:border-box;overscroll-behavior:contain}.settings-pane[hidden]{display:none!important}#settingsModal .settings-pane{position:static;height:auto;padding:0!important;background:transparent!important;display:block;box-sizing:border-box}#settingsModal .settings-pane>.dialog{width:100%!important;max-width:none!important;max-height:none!important;overflow:visible;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0!important;display:block;font:inherit}#settingsModal .settings-pane h2{font-size:20px;margin:0 0 10px}.settings-description{color:var(--muted)}.settings-option{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid var(--line)}.settings-option select{font:inherit;background:var(--vscode-input-bg,var(--panel));color:var(--text);border:1px solid var(--line);border-radius:5px;padding:7px;max-width:60%}
#settingsModal #toolsList{display:block;max-height:none;overflow:visible}#settingsModal .tool-settings-row{display:flex;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:14px 0;background:transparent}#settingsModal .tool-settings-info{flex:1;order:1}#settingsModal .tool-settings-row input{order:2;appearance:none;position:relative;width:36px;height:20px;border:0;border-radius:20px;background:var(--vscode-input-bg,var(--line));cursor:pointer}#settingsModal .tool-settings-row input:before{content:'';position:absolute;width:14px;height:14px;top:3px;left:3px;border-radius:50%;background:#fff}#settingsModal .tool-settings-row input:checked{background:var(--blue)}#settingsModal .tool-settings-row input:checked:before{left:19px}#settingsModal #addonList{max-height:none;overflow:visible}#settingsModal .addon-card{border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;padding:18px 0;margin:0}#settingsModal .addon-card [data-action=toggle]{position:relative;min-height:22px;width:40px;height:22px;padding:0;text-indent:-9999px;border:0;border-radius:20px;background:var(--vscode-input-bg,var(--line));overflow:hidden}#settingsModal .addon-card [data-action=toggle]:after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;background:#fff;border-radius:50%}#settingsModal .addon-card [data-action=toggle][aria-pressed=true]{background:var(--blue)}#settingsModal .addon-card [data-action=toggle][aria-pressed=true]:after{left:21px}
/* Neutral settings surface and grouped navigation follow the reference layout. */
#settingsModal{--panel:#262626;--text:#d7d7d7;--muted:#a6a6a6;--line:#363636;--vscode-input-bg:#303030;--vscode-editor-bg:#262626;--vscode-button-bg:#454545;--vscode-button-fg:#eee}
#settingsModal>.dialog{width:min(1180px,96vw)!important;height:min(820px,94dvh);max-height:94dvh!important;border:1px solid #555!important;background:#262626!important;font:15px/1.5 var(--t-font-ui,system-ui);box-shadow:0 20px 70px #0008;border-radius:14px!important}
#settingsModalTitle{position:relative;padding:16px 60px;text-align:center;font-size:17px;background:#282828;color:var(--text)}.settings-window-lights{position:absolute;left:20px;top:21px;display:flex;gap:8px}.settings-window-lights i{width:12px;height:12px;border-radius:50%;background:#ff6057}.settings-window-lights i:nth-child(2){background:#ffbd2e}.settings-window-lights i:nth-child(3){background:#28c840}
.settings-sidebar{width:260px;padding:24px 16px}.settings-sidebar #settingsSearch{padding:11px 14px 11px 40px;margin:0 0 20px;background:#2c2c2c;border:1px solid #494949;border-radius:25px;color:var(--text);font:inherit}.settings-sidebar{position:relative}.settings-sidebar::before{content:'';position:absolute;left:32px;top:39px;width:12px;height:12px;border:2px solid #aaa;border-radius:50%;pointer-events:none}.settings-sidebar::after{content:'';position:absolute;left:46px;top:52px;width:7px;height:2px;background:#aaa;transform:rotate(45deg);pointer-events:none}
#settingsNav{gap:0}.settings-nav-group{margin:0 0 28px}.settings-nav-group h3{margin:8px 12px 12px;color:#858585;font-size:13px;font-weight:600}.settings-nav-items{display:flex;flex-direction:column;gap:3px}#settingsModal #settingsNav .settings-nav-item{font-size:15px;min-height:42px;padding:9px 12px!important;gap:12px}#settingsModal #settingsNav .settings-nav-item:hover{background:#303030!important}#settingsModal #settingsNav .settings-nav-item.active{background:#363636!important}.settings-nav-item .ic{width:23px;height:23px;color:#aaa;stroke-width:1.7}.settings-nav-item span{overflow-wrap:anywhere;min-width:0}.settings-nav-empty{padding:5px 12px;font-size:12px;color:#858585}
.settings-content{padding:32px 36px;background:#262626}#settingsModal .settings-pane h2{font-size:22px;font-weight:600;margin:0 0 24px;color:var(--text)}.settings-card{border:1px solid #383838;border-radius:12px;padding:0 22px;margin-bottom:24px}.settings-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:22px 0;min-width:0;border-bottom:1px solid #383838}.settings-row:last-child{border-bottom:0}.settings-row-info{flex:1;min-width:0}.settings-row-title{display:block;font-size:16px;font-weight:500;color:var(--text)}.settings-row-description{display:block;color:var(--muted);font-size:14px;margin-top:5px;line-height:1.5}.settings-row-control{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;max-width:48%;min-width:0}.settings-row-control select{min-width:0;max-width:220px!important}.settings-row-control select,.settings-row-control button,.settings-row-control input[type=number]{max-width:100%;box-sizing:border-box;background:#353535;color:var(--text);border:1px solid #454545;padding:8px 11px;border-radius:8px;font:inherit;box-shadow:0 2px 3px #0003;cursor:pointer}.settings-row-control input[type=number]{width:82px;cursor:text}.settings-row-control input[type=color]{width:38px;height:38px;border:0;padding:0;border-radius:50%;overflow:hidden;cursor:pointer;background:transparent}.settings-row-control input[type=color]::-webkit-color-swatch-wrapper{padding:0}.settings-row-control input[type=color]::-webkit-color-swatch{border:1px solid #aaa;border-radius:50%}.settings-section-title{font-size:18px;margin:36px 20px 20px;color:var(--text)}
#settingsModal #toolsList{border:1px solid #383838;border-radius:12px;padding:0 22px;margin:20px 0}.tool-settings-info>span{font-size:15px}.tool-settings-info small{color:var(--muted);font-size:12px}#settingsModal input:focus-visible,#settingsModal select:focus-visible,#settingsModal button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}#settingsModal .settings-switch{appearance:none;position:relative;width:38px;height:22px;border:0;border-radius:20px;background:#555;flex:none;cursor:pointer}#settingsModal .settings-switch:before{content:'';position:absolute;width:16px;height:16px;border-radius:50%;top:3px;left:3px;background:white}#settingsModal .settings-switch:checked{background:var(--blue)}#settingsModal .settings-switch:checked:before{left:19px}
@media(max-width:800px){.settings-sidebar{width:225px;padding:20px 12px}.settings-content{padding:24px 20px}.settings-card{padding:0 16px}.settings-row{gap:14px;flex-wrap:wrap}.settings-row-control{max-width:100%}.settings-sidebar::before{left:28px;top:35px}.settings-sidebar::after{left:42px;top:48px}}
@media(max-width:650px){#settingsModal{padding:8px!important}#settingsModal>.dialog{width:100%!important;height:calc(100dvh - 16px);max-height:calc(100dvh - 16px)!important}.settings-layout{flex-direction:column}.settings-sidebar{width:100%;max-height:220px;min-height:140px;padding:16px 12px;border-right:0;border-bottom:1px solid var(--line);overflow:auto;flex:0 1 220px}.settings-sidebar::before{top:31px}.settings-sidebar::after{top:44px}#settingsSearch{margin-bottom:8px}#settingsNav{display:flex;flex-direction:column}.settings-nav-group{margin-bottom:18px}#settingsModal #settingsNav .settings-nav-item{min-height:36px;font-size:14px;padding:7px 12px!important}.settings-content{padding:20px 16px;flex:1}.settings-row{padding:16px 0}.settings-row-info{flex-basis:100%}.settings-row-control{justify-content:flex-start}.settings-row-title{font-size:15px}.settings-row-description{font-size:13px}.settings-window-lights{left:14px;gap:5px}.settings-window-lights i{width:9px;height:9px}#settingsModalTitle{font-size:15px;padding-left:70px}.settings-option{flex-wrap:wrap}.settings-option select{max-width:100%}}
`;document.head.append(settingsStyle);
