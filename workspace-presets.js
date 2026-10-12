/* System addon: browser-local interface presets, independent of palace content. */
'use strict';
const WORKSPACE_PRESETS_KEY = 'palace.workspacePresets.v1', WORKSPACE_PRESET_LIMIT = 30;
const WORKSPACE_FONTS = ['', 'system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'ui-monospace, monospace'];
let workspacePresetsEnabled = false, workspacePresets = [], workspaceApplying = false;
const workspacePane = newSettingsPane('Workspace Presets', `
<p class="settings-description">Save themes, icons, interface size, tool visibility and panel layout. Presets keep palace content unchanged and are stored in this browser.</p>
<form id="workspacePresetForm" class="persistence-actions"><input id="workspacePresetName" aria-label="Preset name" placeholder="Preset name" maxlength="80" required><button id="workspacePresetSave" type="submit">Save current workspace</button></form>
<div class="persistence-actions"><button id="workspacePresetExport" type="button">Export JSON</button><label class="workspace-import">Import JSON<input id="workspacePresetImport" type="file" accept=".json,application/json"></label></div>
<p id="workspacePresetStatus" role="status" aria-live="polite"></p><div id="workspacePresetList"></div>`);
settingsPage('workspace-presets','Workspace Presets','window',workspacePane);
settingsSections.get('Core plugins').append(settingsPages.get('workspace-presets').button);
function validateWorkspaceConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid workspace configuration.');
  for (const key of ['theme','icons']) if (typeof value[key] !== 'string' || !/^[-a-zA-Z0-9.]{1,120}$/.test(value[key])) throw new Error('Invalid ' + key + '.');
  if (![0,1,2].includes(value.size) || !['edit','view'].includes(value.mode) || !['plan','tour','split','split-rev'].includes(value.layout) || !['2d','3d'].includes(value.planView)) throw new Error('Invalid workspace mode or size.');
  if (!Number.isFinite(value.splitRatio) || value.splitRatio < .05 || value.splitRatio > .95 || !Number.isFinite(value.tourWidth) || value.tourWidth < 280 || value.tourWidth > 2000) throw new Error('Invalid panel dimensions.');
  const appearance = value.appearance || {};
  if (typeof appearance !== 'object' || Array.isArray(appearance) || appearance.accent != null && !/^#[0-9a-f]{6}$/i.test(appearance.accent) || !WORKSPACE_FONTS.includes(appearance.font || '')) throw new Error('Invalid appearance preferences.');
  if (!value.tools || typeof value.tools !== 'object' || Array.isArray(value.tools) || Object.keys(value.tools).length > 500) throw new Error('Invalid tool preferences.');
  for (const [key,visible] of Object.entries(value.tools)) if (!/^(system|addon)\.[a-zA-Z0-9._-]{1,180}$/.test(key) || typeof visible !== 'boolean') throw new Error('Invalid tool preference.');
  return {theme:value.theme,icons:value.icons,size:value.size,mode:value.mode,layout:value.layout,planView:value.planView,splitRatio:value.splitRatio,tourWidth:value.tourWidth,
    appearance:{...(appearance.accent ? {accent:appearance.accent}:{}),...(appearance.font ? {font:appearance.font}:{})},tools:{...value.tools}};
}
function validateWorkspacePreset(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 80) throw new Error('Invalid workspace preset.');
  return {id:value.id,name:value.name.trim(),config:validateWorkspaceConfig(value.config)};
}
function captureWorkspace() {
  refreshSystemTools();
  return validateWorkspaceConfig({theme:getTheme(),icons:activeIconTheme,size:PALACE_UI.size,mode:state.mode,layout:state.layout,planView,
    splitRatio:Math.max(.05,Math.min(.95,state.splitRatio || .5)),tourWidth:Math.max(280,Math.min(2000,state.tourWidth || 460)),
    appearance:settingsAppearancePreferences,tools:Object.fromEntries(PalaceAPI.uiTools().map(tool=>[tool.id,tool.visible]))});
}
function persistWorkspacePresets(next) {
  if (!Array.isArray(next) || next.length > WORKSPACE_PRESET_LIMIT) throw new Error('A maximum of 30 presets is allowed.');
  const normalized = next.map(validateWorkspacePreset);
  if (new Set(normalized.map(p=>p.id)).size !== normalized.length || new Set(normalized.map(p=>p.name.toLowerCase())).size !== normalized.length) throw new Error('Preset names and IDs must be unique.');
  localStorage.setItem(WORKSPACE_PRESETS_KEY,JSON.stringify(normalized)); workspacePresets = normalized;
}
try {
  const stored = JSON.parse(localStorage.getItem(WORKSPACE_PRESETS_KEY) || '[]');
  if (!Array.isArray(stored) || stored.length > WORKSPACE_PRESET_LIMIT) throw new Error('Invalid stored presets.');
  workspacePresets = stored.map(validateWorkspacePreset);
} catch (error) { document.querySelector('#workspacePresetStatus').textContent = 'Unable to load presets: ' + error.message; }
function workspaceMessage(message) { document.querySelector('#workspacePresetStatus').textContent = message; }
async function applyWorkspaceConfig(config) {
  const warnings = [];
  // Write the complete tool preference map once rather than refreshing after every tool.
  refreshSystemTools(); const nextTools = {...toolPreferences};
  for (const [key,visible] of Object.entries(config.tools)) if (palaceTools.has(key)) nextTools[key] = visible;
  localStorage.setItem('palace.tools',JSON.stringify(nextTools));
  localStorage.setItem('palace.settings.appearance',JSON.stringify(config.appearance));
  toolPreferences = nextTools; for (const tool of palaceTools.values()) tool.element.dataset.palaceHidden = String(nextTools[tool.key] === false);
  settingsAppearancePreferences = {...config.appearance}; applySettingsAppearance();
  if (PALACE_THEMES.some(theme=>theme.id===config.theme)) applyTheme(config.theme); else warnings.push('Theme unavailable: '+config.theme);
  if (palaceIconThemes.has(config.icons)) setInterfaceIconTheme(config.icons); else warnings.push('Icon set unavailable: '+config.icons);
  PALACE_UI.setSize(config.size);
  state.mode = config.mode; state.splitRatio = config.splitRatio; state.tourWidth = config.tourWidth; state.layout = config.layout;
  applyLayout(); applyMode();
  if (config.planView === '3d' && !state.levels.length) warnings.push('Open a palace to use the 3D plan.'); else await setPlanView(config.planView);
  if (state.layout !== config.layout) warnings.push('Panel layout adjusted for this screen.');
  renderToolSettings(); return warnings;
}
async function applyWorkspacePreset(id) {
  if (!workspacePresetsEnabled) throw new Error('Enable Workspace Presets in Core plugins.');
  if (workspaceApplying) throw new Error('A workspace preset is already being applied.');
  if (reviewSession || arrange || mergeBusy || recoveryLoading) throw new Error('Finish the current operation before applying a preset.');
  const preset = workspacePresets.find(item=>item.id===id); if (!preset) throw new Error('Preset not found.');
  const config = validateWorkspaceConfig(preset.config), previous = captureWorkspace(); workspaceApplying = true;
  try {
    const warnings = await applyWorkspaceConfig(config);
    workspaceMessage('Applied “'+preset.name+'”.'+(warnings.length?' '+warnings.join(' '):'')); status('Workspace preset applied: '+preset.name); return true;
  } catch (error) {
    try { await applyWorkspaceConfig(previous); } catch (rollback) { workspaceMessage('Unable to restore previous interface preferences: '+rollback.message); }
    throw error;
  } finally { workspaceApplying = false; }
}
function renderWorkspacePresets() {
  const list = document.querySelector('#workspacePresetList'); list.replaceChildren();
  document.querySelector('#workspacePresetSave').disabled = !workspacePresetsEnabled || !!reviewSession;
  document.querySelector('#workspacePresetExport').disabled = !workspacePresetsEnabled;
  document.querySelector('#workspacePresetImport').disabled = !workspacePresetsEnabled;
  if (!workspacePresetsEnabled) { workspaceMessage('Enable Workspace Presets in Core plugins.'); return; }
  if (!workspacePresets.length) { const text = document.createElement('p'); text.className='settings-description'; text.textContent='No presets yet. Set up your workspace and save it above.'; list.append(text); }
  for (const preset of workspacePresets) {
    const card = document.createElement('section'); card.className='workspace-preset'; card.dataset.preset=preset.id;
    const name = document.createElement('input'); name.value=preset.name; name.maxLength=80; name.setAttribute('aria-label','Name of '+preset.name);
    const summary = document.createElement('p'); summary.textContent=preset.config.theme+' · '+preset.config.layout+' · '+['Small','Medium','Large'][preset.config.size];
    const actions = document.createElement('div'); actions.className='persistence-actions';
    for (const [action,title,run] of [
      ['apply','Apply',async()=>applyWorkspacePreset(preset.id)],
      ['rename','Rename',()=>{persistWorkspacePresets(workspacePresets.map(p=>p.id===preset.id?{...p,name:name.value}:p));renderWorkspacePresets();workspaceMessage('Preset renamed.');}],
      ['update','Replace with current',()=>{persistWorkspacePresets(workspacePresets.map(p=>p.id===preset.id?{...p,config:captureWorkspace()}:p));renderWorkspacePresets();workspaceMessage('Preset updated.');}],
      ['delete','Delete',button=>{if(button.dataset.confirm!=='true'){button.dataset.confirm='true';button.textContent='Confirm delete';return;}persistWorkspacePresets(workspacePresets.filter(p=>p.id!==preset.id));renderWorkspacePresets();workspaceMessage('Preset deleted.');}]
    ]) {
      const button=document.createElement('button'); button.type='button'; button.dataset.action=action; button.textContent=title;
      button.disabled=!!reviewSession&&(action==='apply'||action==='update');
      button.onclick=async()=>{button.disabled=true;try{await run(button);}catch(error){workspaceMessage(error.message);}finally{if(button.isConnected)button.disabled=false;}};actions.append(button);
    }
    card.append(name,summary,actions); list.append(card);
  }
}
document.querySelector('#workspacePresetForm').onsubmit=event=>{
  event.preventDefault();try{if(!workspacePresetsEnabled)throw new Error('Workspace Presets is disabled.');if(reviewSession)throw new Error('Stop review first.');persistWorkspacePresets([...workspacePresets,{id:crypto.randomUUID(),name:document.querySelector('#workspacePresetName').value,config:captureWorkspace()}]);document.querySelector('#workspacePresetName').value='';renderWorkspacePresets();workspaceMessage('Preset saved.');}catch(error){workspaceMessage(error.message);}
};
document.querySelector('#workspacePresetExport').onclick=()=>{
  if(!workspacePresetsEnabled)return;downloadBlob(new Blob([JSON.stringify({format:'palace-workspace-presets',version:1,presets:workspacePresets},null,2)],{type:'application/json'}),'workspace-presets.json');
};
document.querySelector('#workspacePresetImport').onchange=async event=>{
  const file=event.target.files[0];if(!file||!workspacePresetsEnabled)return;
  try{if(file.size>5*1024*1024)throw new Error('Preset file exceeds 5 MB.');const value=JSON.parse(await file.text());if(value.format!=='palace-workspace-presets'||value.version!==1||!Array.isArray(value.presets))throw new Error('Unsupported preset file.');const incoming=value.presets.map(validateWorkspacePreset),next=[...workspacePresets];for(const preset of incoming){const existing=next.find(p=>p.id===preset.id||p.name.toLowerCase()===preset.name.toLowerCase());if(existing)throw new Error('Preset already exists: '+preset.name);next.push(preset);}persistWorkspacePresets(next);renderWorkspacePresets();workspaceMessage('Presets imported.');}catch(error){workspaceMessage('Unable to import: '+error.message);}finally{event.target.value='';}
};
const workspaceOpenSettings=openSettingsPage;openSettingsPage=function(id,...args){const result=workspaceOpenSettings(id,...args);if(id==='workspace-presets')renderWorkspacePresets();return result;};
registerSystemAddon({id:'system.workspace-presets',title:'Workspace Presets',description:'Save and restore themes, interface tools and panel layouts.',
  activate(){workspacePresetsEnabled=true;if(!HOTKEYS.some(c=>c.id==='system.workspace-presets.open'))HOTKEYS.push({id:'system.workspace-presets.open',label:'Open workspace presets',group:'System addons',def:'',run:()=>openSettingsPage('workspace-presets')});if(settingsModal.dataset.page==='workspace-presets')renderWorkspacePresets();},
  deactivate(){workspacePresetsEnabled=false;const index=HOTKEYS.findIndex(c=>c.id==='system.workspace-presets.open');if(index>=0)HOTKEYS.splice(index,1);if(settingsModal.dataset.page==='workspace-presets')renderWorkspacePresets();}
});
persistenceStyle.textContent+=`
#workspacePresetName{min-width:0;flex:1;max-width:100%;padding:9px;border:1px solid var(--line);border-radius:6px;background:var(--vscode-input-bg);color:var(--text);font:inherit}.workspace-preset{padding:16px 0;border-bottom:1px solid var(--line)}.workspace-preset>input{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--vscode-input-bg);color:var(--text);font:inherit}.workspace-preset>p{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.workspace-import{display:inline-flex;align-items:center;gap:8px;font-size:12px;flex-wrap:wrap}.workspace-import input{max-width:100%;min-width:0;font:inherit}#workspacePresetStatus{color:var(--muted);overflow-wrap:anywhere}
`;
