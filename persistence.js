/* Local recovery and archive metadata. Uses the editor's existing state and ZIP routines. */
'use strict';
let archiveContext = null;
let recoveryTimer = null;
let recoveryEnabled = false;
let recoveryRevision = 0;
let savedRecoveryRevision = 0;
let recoveryWriting = false;
let recoveryDatabase;
let archiveAssetDirty = false;
let recoveryLoading = false;
const RECOVERY_LIMIT = 5;

const persistenceStyle = document.createElement('style');
persistenceStyle.textContent = `
.modal[hidden]{display:none!important}
.persistence-actions{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.persistence-status{font-size:12px;color:var(--muted);margin:8px 0}
.persistence-dialog{width:min(850px,94vw)!important;max-height:90vh;overflow:auto}
#metaEditor{display:block;width:100%;height:45vh;resize:vertical;background:var(--vscode-input-bg);color:var(--text);border:1px solid var(--line);padding:12px;font:13px/1.5 ui-monospace,monospace}
#metaError{color:var(--red);min-height:1.5em;white-space:pre-wrap}
.recovery-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.persistence-actions button{min-height:32px}
`;
document.head.appendChild(persistenceStyle);
const toolsPanel = document.createElement('div');
toolsPanel.className = 'persistence-actions';
toolsPanel.innerHTML = "<button id=\"recoveryOpen\" type=\"button\">Autosaves</button><button id=\"metaOpen\" type=\"button\">meta.json</button><span class=\"persistence-status\" id=\"offlineStatus\">Offline cache: preparing…</span>";
document.querySelector('#saveModal .dialog').appendChild(toolsPanel);
const recoveryStatus = document.createElement('div');
recoveryStatus.id = 'recoveryStatus';
recoveryStatus.className = 'persistence-status';
recoveryStatus.setAttribute('role', 'status');
recoveryStatus.textContent = "Autosave: checking…";
toolsPanel.after(recoveryStatus);

function persistenceModal(id, title, body) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'modal';
  el.hidden = true;
  el.innerHTML = `<div class="dialog persistence-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}Title"><h2 id="${id}Title">${title}</h2>${body}</div>`;
  document.body.appendChild(el);
  el.addEventListener('mousedown', event => { if (event.target === el) closePersistenceModal(el); });
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); closePersistenceModal(el); }
    if (event.key === 'Tab') {
      const controls = [...el.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled):not([tabindex="-1"]),select:not(:disabled),[tabindex="0"]')].filter(x => x.offsetParent);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  return el;
}
let persistenceReturnFocus;
function showPersistenceModal(el) {
  persistenceReturnFocus = document.activeElement;
  el.hidden = false;
  el.classList.add('show');
  el.querySelector('textarea,button')?.focus();
}
function closePersistenceModal(el) {
  if (!el) return;
  el.classList.remove('show');
  el.hidden = true;
  persistenceReturnFocus?.focus();
}
let recoveryModal = null;
function createRecoveryModal() {
  recoveryModal = persistenceModal('recoveryModal', "Local autosaves", `
<p>The last ${RECOVERY_LIMIT} versions are stored in this browser with images and panoramas. Clearing site data removes them. Export important palaces to a file.</p>
<div id="recoveryList"></div><div class="persistence-actions"><button id="recoveryClose">Close</button></div>`);
  document.querySelector('#recoveryClose').addEventListener('click', () => closePersistenceModal(recoveryModal));
}
const metaModal = persistenceModal('metaModal', "Archive metadata — meta.json", `
<p id="metaArchiveName"></p><p>Changes are included in the next palace export. Download source archive creates a copy with the new meta.json and keeps other files. Reopen this copy to apply tour metadata.</p>
<label for="metaEditor">Metadata JSON object</label><textarea id="metaEditor" spellcheck="false"></textarea>
<div id="metaError" role="alert"></div><div class="persistence-actions"><button id="metaApply" class="primary">Apply</button><button id="metaDownload">Download source archive</button><button id="metaClose">Close</button></div>`);

function writeArchiveMeta(zip) {
  if (archiveContext?.metaText != null) zip.file('meta.json', archiveContext.metaText);
}
const editorOpenArchive = openAnyArchiveBuffer;
openAnyArchiveBuffer = async function(buffer, name) {
  // Resolve a supported nested archive before handing it to the existing loader.
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file('palace.json') && !zip.file('links.json')) {
    const nested = zip.file(/\.(3dview|mpalace|mplace)$/i).filter(f => !f.dir && !/(^|\/)__MACOSX\//.test(f.name));
    if (nested.length === 1) return openAnyArchiveBuffer(await nested[0].async('arraybuffer'), nested[0].name.split('/').pop());
  }
  const context = {
    id: crypto.randomUUID(),
    name: String(name || (zip.file('palace.json') ? 'palace.mpalace' : 'tour.3dview')),
    buffer: buffer.slice(0),
    metaText: zip.file('meta.json') ? await zip.file('meta.json').async('string') : null
  };
  recoveryLoading = true;
  try {
    await editorOpenArchive(buffer, name);
    archiveContext = context;
    resetHistory();
    archiveAssetDirty = true;
  } finally {
    recoveryLoading = false;
    scheduleRecovery();
  }
};
const editorResetPalace = resetPalace;
resetPalace = function() {
  editorResetPalace();
  archiveContext = null;
  scheduleRecovery();
};
function parseMeta() {
  const text = document.querySelector('#metaEditor').value;
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error("meta.json root must be a JSON object.");
  return JSON.stringify(value, null, 2);
}
function applyMeta() {
  try {
    const text = parseMeta();
    if (!archiveContext) throw new Error("Open a .3dview or .mpalace archive first.");
    if (archiveContext.metaText !== text) { requireEditing(); flushHistorySoft(); archiveContext.metaText = text; touch(); }
    document.querySelector('#metaError').textContent = '';
    status("meta.json applied · save the archive to export your changes");
    return true;
  } catch (error) {
    document.querySelector('#metaError').textContent = "Unable to apply: " + error.message;
    return false;
  }
}
document.querySelector('#metaOpen').addEventListener('click', () => {
  document.querySelector('#metaArchiveName').textContent = archiveContext ? "Opened: " + archiveContext.name + (archiveContext.metaText == null ? " · meta.json is missing; you can create it" : '') : "Open .3dview or .mpalace first.";
  document.querySelector('#metaEditor').value = archiveContext?.metaText ?? '{}';
  document.querySelector('#metaError').textContent = '';
  document.querySelector('#metaEditor').disabled = !archiveContext;
  document.querySelector('#metaApply').disabled = !archiveContext;
  document.querySelector('#metaDownload').disabled = !archiveContext?.buffer;
  showPersistenceModal(metaModal);
});
document.querySelector('#metaApply').addEventListener('click', applyMeta);
document.querySelector('#metaDownload').addEventListener('click', async event => {
  if (!applyMeta() || !archiveContext?.buffer) return;
  event.target.disabled = true;
  try {
    const context = archiveContext;
    const zip = await JSZip.loadAsync(context.buffer);
    applyArchivePatches(zip, context);
    if(context.metaText != null) zip.file('meta.json', context.metaText); else zip.remove('meta.json');
    const blob = await zip.generateAsync({type: 'blob', compression: 'DEFLATE', compressionOptions: {level: 6}});
    const name = context.name.replace(/(\.[^.]+)$/, '-meta$1');
    downloadBlob(blob, name === context.name ? name + '-meta.zip' : name);
    status("Archive with updated meta.json downloaded");
  } catch (error) { document.querySelector('#metaError').textContent = "Unable to save archive: " + error.message; }
  finally { event.target.disabled = false; }
});
document.querySelector('#metaClose').addEventListener('click', () => closePersistenceModal(metaModal));
function recoveryDB() {
  return recoveryDatabase ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('palace-recovery', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('versions', {keyPath: 'id', autoIncrement: true});
      request.result.createObjectStore('archives', {keyPath: 'id'});
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Storage is busy in another tab."));
  });
}
function idbResult(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function idbComplete(tx) {
  return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error("Write interrupted")); });
}
function scheduleRecovery() {
  recoveryEnabled = true;
  recoveryRevision++;
  clearTimeout(recoveryTimer);
  recoveryStatus.textContent = "Autosave: changes pending…";
  recoveryTimer = setTimeout(saveRecovery, 1500);
}
const editorTouch = touch, editorTouchSoft = touchSoft, editorRestoreSnapshot = restoreSnapshot;
touch = function() { editorTouch(); scheduleRecovery(); };
touchSoft = function() { editorTouchSoft(); scheduleRecovery(); };
restoreSnapshot = function(snapshot) { editorRestoreSnapshot(snapshot); scheduleRecovery(); };
async function saveRecovery() {
  clearTimeout(recoveryTimer);
  if (!recoveryEnabled || recoveryRevision === savedRecoveryRevision || recoveryWriting) return;
  if (arrange || recoveryLoading) { recoveryTimer = setTimeout(saveRecovery, 1500); return; }
  recoveryWriting = true;
  const revision = recoveryRevision;
  try {
    const db = await recoveryDB();
    const context = archiveContext;
    const record = {
      saved: new Date().toISOString(),
      state: structuredClone(state),
      archive: context ? {id: context.id, name: context.name, metaText: context.metaText, patches: structuredClone(context.patches || {})} : null,
      model: DHM ? {meta: structuredClone(DHM.meta), bin: DHM.bin.slice(0), tex: [...DHM.tex].map(([name, value]) => [name, {bytes: value.bytes}])} : null
    };
    const tx = db.transaction(['versions', 'archives'], 'readwrite');
    const complete = idbComplete(tx);
    complete.catch(() => {});
    if (context?.buffer && archiveAssetDirty) tx.objectStore('archives').put({id: context.id, buffer: context.buffer});
    tx.objectStore('versions').add(record);
    const versions = await idbResult(tx.objectStore('versions').getAll());
    const retained = versions.slice(-RECOVERY_LIMIT);
    versions.slice(0, -RECOVERY_LIMIT).forEach(x => tx.objectStore('versions').delete(x.id));
    const assets = await idbResult(tx.objectStore('archives').getAllKeys());
    const referenced = new Set(retained.map(x => x.archive?.id).filter(Boolean));
    assets.filter(id => !referenced.has(id)).forEach(id => tx.objectStore('archives').delete(id));
    await complete;
    if (archiveContext === context) archiveAssetDirty = false;
    savedRecoveryRevision = revision;
    recoveryStatus.textContent = "Autosaved locally: " + new Date(record.saved).toLocaleTimeString();
  } catch (error) {
    recoveryStatus.textContent = "Autosave unavailable: " + error.message + ". Save the palace to a file.";
    console.warn('PALACE recovery:', error);
  } finally {
    recoveryWriting = false;
    if (recoveryRevision !== revision) recoveryTimer = setTimeout(saveRecovery, 1500);
  }
}
async function recoveryVersions() {
  const db = await recoveryDB();
  return (await idbResult(db.transaction('versions').objectStore('versions').getAll())).reverse();
}
async function restoreRecovery(record) {
  clearTimeout(recoveryTimer);
  if (recoveryWriting) throw new Error("Wait for autosave to finish and try again.");
  const db = await recoveryDB();
  const asset = record.archive ? await idbResult(db.transaction('archives').objectStore('archives').get(record.archive.id)) : null;
  if (record.archive && !asset) throw new Error("Original archive not found in local storage.");
  const restoredState = structuredClone(record.state);
  const model = record.model ? structuredClone(record.model) : null;
  // Dispose only after all persistent data has been read successfully.
  if (reviewSession) endReview();
  editorResetPalace();
  Object.assign(state, restoredState, {dirty: true});
  archiveContext = record.archive ? {...record.archive, buffer: asset.buffer} : null;
  archiveAssetDirty = false;
  if (model) DHM = {meta: model.meta, bin: model.bin, tex: new Map(model.tex.map(([name, value]) => [name, {...value, url: bufferToDataURL(value.bytes, mimeByExt(name))}])), geo: [], tex3: new Map()};
  state.zoom = 1;
  activeLocalPano = null;
  planFitPending = true;
  resetHistory();
  render();
  closePersistenceModal(recoveryModal);
  scheduleRecovery();
  status("Autosave restored from " + new Date(record.saved).toLocaleString());
}
async function showRecovery(event) {
  if (!event?.isTrusted || event.currentTarget !== document.querySelector('#recoveryOpen') || !document.querySelector('#saveModal').classList.contains('show')) return;
  if (!recoveryModal) createRecoveryModal();
  const list = document.querySelector('#recoveryList');
  list.textContent = "Loading…";
  showPersistenceModal(recoveryModal);
  try {
    const versions = await recoveryVersions();
    list.replaceChildren();
    if (!versions.length) list.textContent = "No autosaves yet. They appear after you edit the palace.";
    for (const record of versions) {
      const row = document.createElement('div'); row.className = 'recovery-row';
      const label = document.createElement('span');
      label.textContent = `${record.state.name} · ${new Date(record.saved).toLocaleString()} · floors: ${record.state.levels.length}`;
      const button = document.createElement('button'); button.textContent = "Restore";
      button.addEventListener('click', () => {
        const restore = () => restoreRecovery(record).catch(error => notify("Unable to restore: " + error.message));
        if (state.dirty) {
          closePersistenceModal(recoveryModal);
          ask("Current unsaved changes will be replaced. Restore this version?", restore, {yes: "Restore"});
        }
        else restore();
      });
      row.append(label, button); list.appendChild(row);
    }
  } catch (error) { list.textContent = "Storage unavailable: " + error.message; }
}
document.querySelector('#recoveryOpen').addEventListener('click', showRecovery);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveRecovery(); });
window.addEventListener('pagehide', saveRecovery);
(async () => {
  try {
    const versions = await recoveryVersions();
    if (!recoveryEnabled) recoveryStatus.textContent = versions.length ? "A previous palace is available for recovery" : "Autosave enabled · changes are saved in this browser";
  } catch (error) { recoveryStatus.textContent = "Autosave unavailable: " + error.message; }
})();

const offlineStatus = document.querySelector('#offlineStatus');
if ('serviceWorker' in navigator && window.isSecureContext) {
  let hadOfflineController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadOfflineController) { hadOfflineController = true; return; }
    if (!state.dirty && !state.levels.length && !archiveContext && !recoveryLoading) { location.reload(); return; }
    offlineStatus.textContent = "Update installed · save your palace and reload";
  });
  navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(async registration => {
    const watchInstallation = () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant') offlineStatus.textContent = "Unable to prepare the offline cache. Check free space and reload";
      });
    };
    watchInstallation();
    registration.addEventListener('updatefound', watchInstallation);
    await navigator.serviceWorker.ready;
    const update = () => { offlineStatus.textContent = "Offline cache ready · external tours require a connection"; };
    update();
    if (registration.waiting) offlineStatus.textContent = "Update ready · close the app tabs and reopen";
  }).catch(error => { offlineStatus.textContent = "Offline cache unavailable: " + error.message; });
} else offlineStatus.textContent = "Offline cache requires HTTPS or localhost";
