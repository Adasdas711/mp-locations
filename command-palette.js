/* System addon: one searchable command list for native actions and active plugins. */
'use strict';
let commandPaletteEnabled = false, commandPaletteIndex = 0, commandPaletteResults = [];
const commandPaletteModal = persistenceModal('commandPalette', 'Command Palette', `
<input id="commandPaletteSearch" type="search" role="combobox" aria-label="Search commands" aria-autocomplete="list" aria-expanded="true" aria-controls="commandPaletteResults" placeholder="Search commands…" autocomplete="off">
<div id="commandPaletteResults" role="listbox" aria-label="Commands"></div>
<p id="commandPaletteStatus" role="status" aria-live="polite"></p>
<footer class="palette-footer"><span>↑ ↓ Navigate · Enter Run · Esc Close</span><button id="commandPaletteClose" type="button">Close</button></footer>`);
const paletteSettings = newSettingsPane('Command Palette', '<p class="settings-description">Search built-in actions and commands from active community plugins. Navigate with the arrow keys and run a command with Enter.</p><div class="settings-card">' + settingsRow('Open command palette', 'Default shortcut: Ctrl+P / ⌘P. Customize it in Hotkeys.', '<button id="commandPaletteOpen" type="button">Open palette</button>') + '</div><p id="commandPaletteSettingsStatus" role="status"></p>');
settingsPage('command-palette', 'Command Palette', 'search', paletteSettings);
settingsSections.get('Core plugins').append(settingsPages.get('command-palette').button);
function systemCommandList() {
  const results = HOTKEYS.filter(command => !addonKeybindings.has(command.id)).map(command => ({
    key: 'system:' + command.id, id: command.id, title: command.label,
    group: command.group || 'System', shortcut: hkText(hkBinding(command.id)),
    enabled: (!reviewSession || ['review.start', 'file.save', 'hotkeys.open', 'system.command-palette.open'].includes(command.id)) && (canEditPlan() || !['plans.upload','tool.marker','tool.camera'].includes(command.id)),
    reason: reviewSession ? 'Stop review first' : 'Switch to edit mode',
    run: command.id === 'plans.upload' ? () => { if (!canEditPlan()) throw new Error('Switch to edit mode.'); openPlansModal(); } : command.run
  }));
  for (const record of addonPackages.values()) {
    const host = addonHosts.get(record.id);
    if (!addonMode || !record.enabled || !host?.ready || host.error) continue;
    for (const command of record.manifest.contributes?.commands || []) {
      if (!host.commands.has(command.id)) continue;
      // Shortcut contributions may already expose this command under another ID.
      results.push({key: 'plugin:' + record.id + ':' + command.id, id: command.id, title: command.title,
        group: record.manifest.name, shortcut: hkText(hkBinding([...addonKeybindings.values()].find(binding=>binding.owner===record.id&&binding.command===command.id)?.id)), enabled: !reviewSession,
        run: () => executeAddon(record.id, command.id)});
    }
  }
  results.push({key:'system:edit.undo',id:'edit.undo',title:'Undo',group:'Editing',shortcut:hkText('Ctrl+KeyZ'),enabled:canEditPlan()&&!reviewSession&&historyIndex>0,reason:'Nothing to undo in the current mode',run:undo});
  results.push({key:'system:edit.redo',id:'edit.redo',title:'Redo',group:'Editing',shortcut:hkText('Ctrl+Shift+KeyZ'),enabled:canEditPlan()&&!reviewSession&&historyIndex<history.length-1,reason:'Nothing to redo in the current mode',run:redo});
  results.push({key:'system:plugins.open',id:'plugins.open',title:'Manage community plugins',group:'System',shortcut:hkText('Ctrl+Shift+KeyP'),enabled:true,run:()=>openSettingsPage('addons')});
  results.push({key: 'system:settings.open', id: 'settings.open', title: 'Open settings', group: 'System', shortcut: '', enabled: true, run: () => openSettingsPage()});
  if (changeHistoryEnabled) results.push({key:'system:history.open',id:'history.open',title:'Open change history',group:'System addons',shortcut:'',enabled:true,run:()=>openSettingsPage('history')});
  return results;
}
function paletteScore(command, query) {
  if (!query) return 1;
  const title = command.title.toLowerCase(), text = (title + ' ' + command.group + ' ' + command.id).toLowerCase();
  if (title === query) return 1000;
  if (title.startsWith(query)) return 800;
  if (query.split(/\s+/).every(word => text.includes(word))) return 600;
  let cursor = 0; for (const letter of query.replace(/\s/g, '')) { cursor = text.indexOf(letter, cursor); if (cursor < 0) return 0; cursor++; }
  return 100;
}
function renderCommandPalette(reset = true) {
  const query = document.querySelector('#commandPaletteSearch').value.trim().toLowerCase();
  commandPaletteResults = systemCommandList().map((command, index) => ({command, index, score: paletteScore(command, query)}))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 100).map(item => item.command);
  if (reset) commandPaletteIndex = 0;
  commandPaletteIndex = Math.min(commandPaletteIndex, Math.max(0, commandPaletteResults.length - 1));
  const list = document.querySelector('#commandPaletteResults'); list.replaceChildren();
  for (const [index, command] of commandPaletteResults.entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.id = 'palette-command-' + index;
    button.className = 'palette-command'; button.role = 'option'; button.tabIndex = -1;
    button.dataset.commandKey = command.key; button.setAttribute('aria-selected', String(index === commandPaletteIndex));
    button.setAttribute('aria-disabled', String(!command.enabled));
    const info = document.createElement('span'), title = document.createElement('strong'), group = document.createElement('small'), shortcut = document.createElement('kbd');
    title.textContent = command.title; group.textContent = command.group + (command.enabled ? '' : ' · '+(command.reason||'Stop review first'));
    shortcut.textContent = command.shortcut; info.append(title, group); button.append(info, shortcut);
    button.onclick = () => runPaletteCommand(command); list.append(button);
  }
  const input = document.querySelector('#commandPaletteSearch');
  if (commandPaletteResults.length) input.setAttribute('aria-activedescendant', 'palette-command-' + commandPaletteIndex); else input.removeAttribute('aria-activedescendant');
  document.querySelector('#commandPaletteStatus').textContent = commandPaletteResults.length ? commandPaletteResults.length + ' commands' : 'No matching commands.';
}
function selectPaletteCommand(index) {
  if (!commandPaletteResults.length) return;
  commandPaletteIndex = (index + commandPaletteResults.length) % commandPaletteResults.length;
  for (const [i, element] of [...document.querySelector('#commandPaletteResults').children].entries()) element.setAttribute('aria-selected', String(i === commandPaletteIndex));
  const selected = document.getElementById('palette-command-' + commandPaletteIndex);
  document.querySelector('#commandPaletteSearch').setAttribute('aria-activedescendant', selected.id); selected.scrollIntoView({block:'nearest'});
}
async function runPaletteCommand(command) {
  if (!command || !commandPaletteEnabled) return;
  if (!command.enabled) { document.querySelector('#commandPaletteStatus').textContent = command.reason || 'Stop review before running this command.'; return; }
  closePersistenceModal(commandPaletteModal);
  try { await command.run(); } catch (error) { openCommandPalette(); document.querySelector('#commandPaletteStatus').textContent = 'Command failed: ' + error.message; }
}
function openCommandPalette() {
  if (!commandPaletteEnabled) return;
  closeSettings(); document.querySelector('#commandPaletteSearch').value = '';
  renderCommandPalette(); showPersistenceModal(commandPaletteModal); document.querySelector('#commandPaletteSearch').focus();
}
new MutationObserver(()=>{if(commandPaletteEnabled&&!commandPaletteModal.hidden)renderCommandPalette(false);}).observe(document.querySelector('#addonList'),{childList:true});
document.querySelector('#commandPaletteSearch').oninput = () => renderCommandPalette();
document.querySelector('#commandPaletteSearch').addEventListener('keydown', event => {
  if (['ArrowDown','ArrowUp','Enter'].includes(event.key)) { event.preventDefault(); event.stopPropagation();
    if (event.key === 'Enter') runPaletteCommand(commandPaletteResults[commandPaletteIndex]);
    else selectPaletteCommand(commandPaletteIndex + (event.key === 'ArrowDown' ? 1 : -1));
  }
});
document.querySelector('#commandPaletteClose').onclick = () => closePersistenceModal(commandPaletteModal);
document.querySelector('#commandPaletteOpen').onclick = openCommandPalette;
document.querySelector('#commandPaletteOpen').disabled = true;
document.querySelector('#commandPaletteSettingsStatus').textContent = 'Enable Command Palette in Core plugins.';
window.addEventListener('keydown', event => {
  if (!commandPaletteEnabled || event.isComposing || hkRecording || event.repeat) return;
  const binding = hkBinding('system.command-palette.open');
  if (!binding || hkFromEvent(event) !== binding) return;
  if (hkTypingTarget(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) return;
  // Settings may open the palette; other dialogs retain their input and focus.
  if ([...document.querySelectorAll('.modal.show')].some(el => el !== settingsModal && el !== commandPaletteModal)) {
    event.preventDefault(); return;
  }
  event.preventDefault(); event.stopImmediatePropagation(); openCommandPalette();
}, true);
registerSystemAddon({id:'system.command-palette',title:'Command Palette',description:'Find and run built-in actions and active plugin commands.',
  activate() {
    commandPaletteEnabled = true;
    if (!HOTKEYS.some(command => command.id === 'system.command-palette.open')) HOTKEYS.push({id:'system.command-palette.open',label:'Open command palette',group:'System addons',def:HOTKEYS.some(c=>hkBinding(c.id)==='Ctrl+KeyP')?'':'Ctrl+KeyP',run:openCommandPalette});
    const binding=hkBinding('system.command-palette.open'),conflict=HOTKEYS.find(c=>c.id!=='system.command-palette.open'&&binding&&hkBinding(c.id)===binding);
    if(conflict){hkOverrides['system.command-palette.open']='';hkSave();}
    document.querySelector('#commandPaletteOpen').disabled = false;
    document.querySelector('#commandPaletteSettingsStatus').textContent = conflict?'Shortcut already used by '+conflict.label+'. Assign another in Hotkeys.':'';
  },
  deactivate() {
    commandPaletteEnabled = false; closePersistenceModal(commandPaletteModal);
    const index = HOTKEYS.findIndex(c=>c.id==='system.command-palette.open'); if (index >= 0) HOTKEYS.splice(index,1);
    document.querySelector('#commandPaletteOpen').disabled = true; document.querySelector('#commandPaletteSettingsStatus').textContent = 'Enable Command Palette in Core plugins.';
  }
});
persistenceStyle.textContent += `
#commandPalette>.dialog{width:min(650px,94vw)!important;box-sizing:border-box;border-radius:12px;padding:18px;font:14px/1.5 var(--t-font-ui,system-ui)}
#commandPaletteSearch{width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--line);border-radius:7px;background:var(--vscode-input-bg);color:var(--text);font:inherit}
#commandPaletteResults{max-height:50dvh;overflow:auto;margin-top:12px;overscroll-behavior:contain}.palette-command{display:flex;justify-content:space-between;align-items:center;gap:12px;width:100%;padding:10px 12px;background:transparent;color:var(--text);border:0;border-radius:6px;text-align:left;font:inherit;cursor:pointer}.palette-command[aria-selected=true]{background:var(--t-sel,var(--line))}.palette-command[aria-disabled=true]{opacity:.5}.palette-command strong{display:block;font-weight:500}.palette-command small{display:block;color:var(--muted);font-size:11px}.palette-command kbd{white-space:nowrap;flex:none;font-size:11px}.palette-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}#commandPaletteStatus{font-size:12px;color:var(--muted)}
`;
