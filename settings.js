/* One settings window: navigation on the left, existing live controls on the right. */
'use strict';
const settingsModal=persistenceModal('settingsModal','Настройки',`<button id="settingsClose" type="button" aria-label="Закрыть настройки">×</button><div class="settings-layout"><aside class="settings-sidebar"><input id="settingsSearch" type="search" placeholder="Поиск настроек…" aria-label="Поиск настроек"><nav id="settingsNav" aria-label="Разделы настроек"></nav></aside><main class="settings-content" id="settingsContent"></main></div>`);
const settingsNav=document.querySelector('#settingsNav'),settingsContent=document.querySelector('#settingsContent');
const settingsPages=new Map();
function settingsPage(id,title,icon,element,button){
 const dialog=element.querySelector(':scope > .dialog');if(dialog){dialog.removeAttribute('role');dialog.removeAttribute('aria-modal');dialog.removeAttribute('aria-labelledby')}
 const heading=element.querySelector('h2');if(heading){heading.id=heading.id||'settings-'+id+'-title';element.setAttribute('role','region');element.setAttribute('aria-labelledby',heading.id)}
 element.classList.remove('modal','show');element.classList.add('settings-pane');element.hidden=true;element.dataset.settingsPage=id;settingsContent.append(element);
 button=button||document.createElement('button');button.type='button';button.className='settings-nav-item';button.removeAttribute('data-palace-hidden');button.removeAttribute('data-palace-tool');button.dataset.settingsPage=id;
 button.innerHTML='<svg class="ic"><use href="#i-'+icon+'"/></svg><span></span>';button.querySelector('span').textContent=title;button.title=title;button.setAttribute('aria-label',title);button.onclick=()=>openSettingsPage(id);settingsNav.append(button);
 settingsPages.set(id,{title,element,button});
}
const appearanceSettings=document.createElement('section');appearanceSettings.innerHTML='<div class="dialog"><h2>Оформление</h2><p class="settings-description">Тема и размер интерфейса.</p><label class="settings-option"><span>Цветовая тема</span><select id="settingsTheme" aria-label="Цветовая тема"></select></label><label class="settings-option"><span>Размер интерфейса</span><select id="settingsSize" aria-label="Размер интерфейса"><option value="0">Маленький</option><option value="1">Средний</option><option value="2">Большой</option></select></label></div>';
settingsPage('appearance','Оформление','contrast',appearanceSettings);
settingsPage('tools','Инструменты','gear',toolsModal);
settingsPage('hotkeys','Горячие клавиши','keyboard',document.querySelector('#hotkeysModal'),document.querySelector('#abHotkeys'));
settingsPage('addons','Аддоны','braces',addonModal,addonsButton);
for(const key of ['system.addonsOpen','system.abHotkeys'])palaceTools.delete(key);
// File actions remain available through File, rather than occupying the sidebar.
const fileSettingsActions=document.createElement('div');fileSettingsActions.className='persistence-actions';fileSettingsActions.id='fileSettingsActions';
const createPalaceButton=document.querySelector('#newBtn');createPalaceButton.className='';createPalaceButton.textContent='Новый дворец';createPalaceButton.removeAttribute('data-palace-hidden');createPalaceButton.removeAttribute('data-palace-tool');palaceTools.delete('system.newBtn');
createPalaceButton.onclick=()=>{document.querySelector('#saveModal').classList.remove('show');newPalace()};
const fileAddPlans=document.createElement('button');fileAddPlans.id='fileAddPlans';fileAddPlans.type='button';fileAddPlans.textContent='Добавить планы';fileAddPlans.onclick=()=>{if(!canEditPlan())return;document.querySelector('#saveModal').classList.remove('show');openPlansModal()};
fileSettingsActions.append(createPalaceButton,fileAddPlans);document.querySelector('#saveModal .dlg-head').after(fileSettingsActions);
const settingsApplyMode=applyMode;applyMode=function(...args){const result=settingsApplyMode(...args);fileAddPlans.disabled=!canEditPlan();return result};fileAddPlans.disabled=!canEditPlan();
settingsButton.title='Настройки';settingsButton.setAttribute('aria-label','Настройки');settingsButton.dataset.short='Настройки';
const settingsOriginalShow=showPersistenceModal,settingsOriginalClose=closePersistenceModal;
showPersistenceModal=function(modal){const page=modal?.dataset.settingsPage;if(page)return openSettingsPage(page);return settingsOriginalShow(modal)};
closePersistenceModal=function(modal){if(modal===settingsModal||modal?.dataset.settingsPage)return closeSettings();return settingsOriginalClose(modal)};
function syncSettingsAppearance(){
 const select=document.querySelector('#settingsTheme');select.replaceChildren();for(const theme of PALACE_THEMES)select.add(new Option(theme.name,theme.id));select.value=getTheme();document.querySelector('#settingsSize').value=String(window.PALACE_UI?.size??1);
}
function openSettingsPage(id='tools'){
 const selected=settingsPages.get(id);if(!selected)return;
 for(const [key,page]of settingsPages){page.element.hidden=key!==id;page.element.classList.toggle('show',key===id);page.button.classList.toggle('active',key===id);page.button.setAttribute('aria-current',key===id?'page':'false')}
 settingsModal.dataset.page=id;
 if(id==='tools'){refreshSystemTools();renderToolSettings()}
 if(id==='addons')renderAddons();
 if(id==='appearance')syncSettingsAppearance();
 if(id==='hotkeys'){hkRecording=null;renderHotkeys()}
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
document.querySelector('#settingsTheme').onchange=event=>applyTheme(event.target.value);
document.querySelector('#settingsSize').onchange=event=>window.PALACE_UI?.setSize(Number(event.target.value));
document.querySelector('#settingsSearch').oninput=event=>{
 const query=event.target.value.trim().toLowerCase(),matches=[];
 const extra={appearance:'тема цвет размер интерфейса '+PALACE_THEMES.map(t=>t.name).join(' '),tools:'системные инструменты '+[...palaceTools.values()].map(t=>t.label).join(' '),hotkeys:'сочетания клавиш '+HOTKEYS.map(k=>k.label).join(' '),addons:'расширения установка '+[...addonPackages.values()].map(p=>p.manifest.name).join(' ')};
 for(const [id,page]of settingsPages){const matched=!query||(page.title+' '+extra[id]).toLowerCase().includes(query);page.button.hidden=!matched;if(matched)matches.push(id)}
 if(!query){document.querySelector('#toolsFilter').value='';document.querySelector('#addonSearch').value='';document.querySelector('#hkFilter').value='';renderToolSettings();renderAddons();renderHotkeys()}
 if(query&&matches.length===1){const id=matches[0];openSettingsPage(id);if(id==='tools'){document.querySelector('#toolsFilter').value=[...palaceTools.values()].some(t=>(t.label+' '+t.owner).toLowerCase().includes(query))?query:'';renderToolSettings()}if(id==='addons'){document.querySelector('#addonSearch').value=[...addonPackages.values()].some(p=>(p.id+' '+p.manifest.name+' '+(p.manifest.contributes?.commands||[]).map(c=>c.title).join(' ')).toLowerCase().includes(query))?query:'';renderAddons()}if(id==='hotkeys'){document.querySelector('#hkFilter').value=HOTKEYS.some(k=>k.label.toLowerCase().includes(query))?query:'';renderHotkeys()}}
};
const settingsStyle=document.createElement('style');settingsStyle.textContent=`
#settingsModal{padding:16px!important;align-items:center!important;box-sizing:border-box}#settingsModal>.dialog{position:relative;width:min(1080px,96vw)!important;height:min(760px,92dvh);max-height:92dvh!important;padding:0!important;display:flex;flex-direction:column;overflow:hidden;border-radius:12px!important;font:13px/1.5 system-ui;box-sizing:border-box}#settingsModalTitle{margin:0;padding:16px 22px;border-bottom:1px solid var(--line);font-size:17px;flex:none}#settingsClose{position:absolute;right:12px;top:9px;background:transparent;border:0;font:24px system-ui;color:var(--muted);cursor:pointer}
.settings-layout{display:flex;flex:1;min-height:0}.settings-sidebar{width:220px;flex:none;padding:18px 12px;background:var(--vscode-editor-bg,var(--panel));border-right:1px solid var(--line);overflow:auto;box-sizing:border-box}#settingsSearch{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--line);border-radius:18px;background:var(--vscode-input-bg,var(--panel));color:var(--text);font:inherit;margin-bottom:20px}#settingsNav{display:flex;flex-direction:column;gap:4px}#settingsModal #settingsNav .settings-nav-item{display:flex!important;align-items:center;gap:10px;min-height:36px;padding:8px 10px!important;border:0!important;border-radius:6px;background:transparent!important;color:var(--text);text-align:left;font:inherit;cursor:pointer}#settingsModal #settingsNav .settings-nav-item[hidden]{display:none!important}.settings-nav-item .ic{width:18px;height:18px;flex:none}.settings-nav-item.active{background:var(--vscode-input-bg,var(--line))!important}.settings-nav-item:focus-visible{outline:2px solid var(--blue)}.settings-content{flex:1;min-width:0;overflow:auto;padding:28px 32px;box-sizing:border-box;overscroll-behavior:contain}.settings-pane[hidden]{display:none!important}#settingsModal .settings-pane{position:static;height:auto;padding:0!important;background:transparent!important;display:block;box-sizing:border-box}#settingsModal .settings-pane>.dialog{width:100%!important;max-width:none!important;max-height:none!important;overflow:visible;padding:0!important;background:transparent!important;border:0!important;box-shadow:none!important;border-radius:0!important;display:block;font:inherit}#settingsModal .settings-pane h2{font-size:20px;margin:0 0 10px}.settings-description{color:var(--muted)}.settings-option{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid var(--line)}.settings-option select{font:inherit;background:var(--vscode-input-bg,var(--panel));color:var(--text);border:1px solid var(--line);border-radius:5px;padding:7px;max-width:60%}
#settingsModal #toolsList{display:block;max-height:none;overflow:visible}#settingsModal .tool-settings-row{display:flex;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:14px 0;background:transparent}#settingsModal .tool-settings-info{flex:1;order:1}#settingsModal .tool-settings-row input{order:2;appearance:none;position:relative;width:36px;height:20px;border:0;border-radius:20px;background:var(--vscode-input-bg,var(--line));cursor:pointer}#settingsModal .tool-settings-row input:before{content:'';position:absolute;width:14px;height:14px;top:3px;left:3px;border-radius:50%;background:#fff}#settingsModal .tool-settings-row input:checked{background:var(--blue)}#settingsModal .tool-settings-row input:checked:before{left:19px}#settingsModal #addonList{max-height:none;overflow:visible}#settingsModal .addon-card{border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;padding:18px 0;margin:0}#settingsModal .addon-card [data-action=toggle]{position:relative;min-height:22px;width:40px;height:22px;padding:0;text-indent:-9999px;border:0;border-radius:20px;background:var(--vscode-input-bg,var(--line));overflow:hidden}#settingsModal .addon-card [data-action=toggle]:after{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;background:#fff;border-radius:50%}#settingsModal .addon-card [data-action=toggle][aria-pressed=true]{background:var(--blue)}#settingsModal .addon-card [data-action=toggle][aria-pressed=true]:after{left:21px}
@media(max-width:650px){#settingsModal{padding:8px!important}#settingsModal>.dialog{width:100%!important;height:calc(100dvh - 16px);max-height:calc(100dvh - 16px)!important}.settings-layout{flex-direction:column}.settings-sidebar{width:100%;padding:10px 12px;border-right:0;border-bottom:1px solid var(--line);overflow:visible}#settingsSearch{margin-bottom:8px}#settingsNav{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}.settings-nav-item{padding:6px!important;min-height:32px;font-size:12px}.settings-content{padding:18px 16px}.settings-option{flex-wrap:wrap}.settings-option select{max-width:100%}}
`;document.head.append(settingsStyle);
