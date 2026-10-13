'use strict';

let disposables = [], settings = {}, addonApi, created = 0, creationQueue = Promise.resolve();

function paint(project) {
  const name = document.querySelector('#starterName');
  if (!name) return;
  name.textContent = project.name;
  const count = document.querySelector('#starterCount');
  count.hidden = !settings.showCount;
  count.textContent = 'Loci: ' + project.levels.reduce((sum, floor) => sum + floor.markers.length, 0);
  document.querySelector('#starterCreated').textContent = 'Created by this addon: ' + created;
  const floor = project.levels[project.active];
  document.querySelector('#starterAdd').disabled = !floor || !(floor.w > 0 && floor.h > 0) || project.mode !== 'edit';
}

async function refresh() { paint(await addonApi.project.read()); }
function showError(error) {
  const status = document.querySelector('#starterStatus');
  if (status) status.textContent = error.message || String(error);
}

function addCenter() {
  const task = creationQueue.then(createCenter);
  creationQueue = task.catch(() => {});
  return task;
}

async function createCenter() {
  const project = await addonApi.project.read(), floor = project.levels[project.active];
  if (!floor || !(floor.w > 0 && floor.h > 0)) throw new Error('Open a floor plan first.');
  const result = await addonApi.markers.add({level: floor.index, x: floor.w / 2, y: floor.h / 2, note: settings.note});
  // A storage failure does not undo the locus already created in the project.
  const next = created + 1;
  try { await addonApi.storage.set('created', next); created = next; }
  catch (error) { showError(new Error('Locus added, but the addon counter could not be saved: ' + error.message)); }
  await refresh();
  await addonApi.ui.showMessage('Locus added at the center of the floor');
  return result;
}

async function openPanel() {
  await addonApi.ui.showPanel('ai.starter.panel', `
    <style>
      h2{font-size:20px;margin:0 0 12px}.muted{color:var(--muted,#aaa)}
      button{font:inherit;padding:9px 12px;border-radius:6px;border:1px solid var(--line,#454545);background:var(--vscode-button-bg,#3b3b3b);color:var(--vscode-button-fg,var(--text,#ddd))}
      .actions{display:flex;gap:8px;flex-wrap:wrap}label{display:block;margin:12px 0}input[type=text]{width:100%;box-sizing:border-box}
      p{overflow-wrap:anywhere}#starterStatus{min-height:1.5em}
    </style>
    <h2>AI starter</h2><p id="starterName"></p><p id="starterCount"></p>
    <p id="starterCreated" class="muted"></p>
    <label>Default note<input id="starterNote" type="text" maxlength="2000" aria-label="Default note"></label>
    <div class="actions"><button id="starterAdd" type="button">Add locus at center</button><button id="starterSave" type="button">Save note</button></div>
    <p id="starterStatus" role="status" aria-live="polite"></p>
  `);
  const note = document.querySelector('#starterNote'); note.value = settings.note;
  document.querySelector('#starterAdd').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await addCenter(); } catch (error) { showError(error); }
    finally { try { await refresh(); } catch (error) { showError(error); } }
  };
  document.querySelector('#starterSave').onclick = async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      settings = await addonApi.settings.update({note: note.value});
      document.querySelector('#starterStatus').textContent = 'Note saved.';
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  };
  await refresh();
}

exports.activate = async api => {
  addonApi = api; settings = await api.settings.read();
  const stored = await api.storage.get('created'); created = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
  disposables.push(api.commands.register('ai.starter.open', openPanel));
  disposables.push(api.commands.register('ai.starter.center', addCenter));
  disposables.push(api.onProjectChanged(paint));
  disposables.push(api.onSettingsChanged(next => {
    settings = next;
    const note = document.querySelector('#starterNote');
    if (note && document.activeElement !== note) note.value = next.note;
    refresh().catch(showError);
  }));
  try {
    await api.keybindings.register({id: 'ai.starter.open-key', command: 'ai.starter.open', key: 'Ctrl+Alt+Shift+KeyU'});
  } catch (error) {
    await api.ui.showMessage('AI starter shortcut unavailable: ' + error.message);
  }
};

exports.deactivate = () => {
  for (const disposable of disposables) disposable.dispose();
  disposables = [];
};
