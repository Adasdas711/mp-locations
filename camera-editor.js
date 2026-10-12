/* Unified camera editing. Selection never navigates away from the plan. */
let editedCameraId = null, cameraLinkSource = null;
const cameraEditor = document.createElement('section');
cameraEditor.id = 'cameraEditor';
cameraEditor.className = 'canvas-ctl';
cameraEditor.setAttribute('aria-label', 'Редактирование камеры');
cameraEditor.innerHTML = `<label>Камера <select id="cameraEditorSelect" aria-label="Выбрать камеру"></select></label>
<p id="cameraEditorHint"></p><div class="camera-editor-actions">
<button id="cameraEditorLink">Связать с другой камерой</button>
<button id="cameraEditorStart">Сделать начальной</button>
<button id="cameraEditorDelete">Удалить камеру</button></div><div id="cameraEditorLinks"></div>`;
document.querySelector('#stage').append(cameraEditor);
const cameraStyle = document.createElement('style');
cameraStyle.textContent = `#cameraEditor{position:absolute;left:12px;right:12px;bottom:12px;z-index:35;max-width:480px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel,#fff);color:var(--text);box-shadow:0 4px 20px #0002;max-height:40%;overflow:auto}#cameraEditor[hidden]{display:none}#cameraEditor p{margin:8px 0;font-size:13px}#cameraEditor label{display:flex;gap:8px;align-items:center}#cameraEditor select{min-width:0;flex:1}#cameraEditor button{padding:8px;border-radius:8px;cursor:pointer}.camera-editor-actions{display:flex;gap:6px;flex-wrap:wrap}#cameraEditorLinks{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.camera-edit-selected{outline:3px solid var(--accent,#4878e8);outline-offset:3px}.camera-link-lines{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.tool-camera #markerCtl{display:none}@media(max-width:600px){#cameraEditor{padding:8px;max-height:35%;bottom:8px;left:8px;right:8px}#cameraEditor button{font-size:12px}}`;
document.head.append(cameraStyle);
function selectCameraForEditing(id) {
  if (!canEditPlan() || state.tool !== 'camera' || !state.panoramas[id]) return;
  if (cameraLinkSource && id !== cameraLinkSource) {
    changeCameraTransition(cameraLinkSource, id, true);
    editedCameraId = cameraLinkSource;
    cameraLinkSource = null;
  } else editedCameraId = id;
  refreshCameraEditor();
}
function refreshCameraEditor() {
  cameraEditor.hidden = state.tool !== 'camera' || !canEditPlan();
  if (cameraEditor.hidden) { cameraLinkSource = null; return; }
  const panos = state.panoramas || {};
  if (!panos[editedCameraId]) editedCameraId = null;
  if (!panos[cameraLinkSource]) cameraLinkSource = null;
  const select = document.querySelector('#cameraEditorSelect');
  select.replaceChildren(new Option('Выберите камеру на плане', ''));
  Object.entries(panos).forEach(([id,p]) => select.add(new Option(p.room || id,id)));
  select.value = editedCameraId || '';
  document.querySelector('#cameraEditorHint').textContent = cameraLinkSource
    ? 'Нажмите другую камеру на плане или выберите её в списке. Повторное нажатие кнопки отменит связывание.'
    : editedCameraId ? 'Перетащите выбранную камеру по плану. Переходы работают в обе стороны.' : 'Нажмите камеру на плане или выберите её в списке.';
  ['Link','Start','Delete'].forEach(name => document.querySelector('#cameraEditor'+name).disabled = !editedCameraId);
  document.querySelector('#cameraEditorLink').textContent = cameraLinkSource ? 'Отменить связывание' : 'Связать с другой камерой';
  document.querySelector('#cameraEditorStart').textContent = state.startPano === editedCameraId && editedCameraId ? 'Убрать начальную' : 'Сделать начальной';
  const list = document.querySelector('#cameraEditorLinks');list.replaceChildren();
  if (editedCameraId) Object.entries(panos).forEach(([id,p]) => {
    if (id === editedCameraId || !(linkedCamera(editedCameraId,id)||linkedCamera(id,editedCameraId))) return;
    const button=document.createElement('button');button.textContent='Удалить переход: '+(p.room||id);button.dataset.target=id;
    button.onclick=()=>{changeCameraTransition(editedCameraId,id,false);refreshCameraEditor()};list.append(button);
  });
  document.querySelectorAll('#plan .plan-cam').forEach(node=>{
    node.classList.toggle('camera-edit-selected',node.dataset.pano===editedCameraId);
    node.setAttribute('aria-pressed',String(node.dataset.pano===editedCameraId));
    node.title='Редактировать: '+(panos[node.dataset.pano]?.room||node.dataset.pano);
  });
  document.querySelector('#plan .camera-link-lines')?.remove();
  const plan=document.querySelector('#plan');
  if (!plan || !editedCameraId || !panos[editedCameraId]?.planPx) return;
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('camera-link-lines');
  const from=panos[editedCameraId];
  Object.entries(panos).forEach(([id,p])=>{
    if (!p.planPx || p.floorId!==from.floorId || id===editedCameraId || !(linkedCamera(editedCameraId,id)||linkedCamera(id,editedCameraId)))return;
    const line=document.createElementNS(svg.namespaceURI,'line');
    Object.entries({x1:from.planPx.x,y1:from.planPx.y,x2:p.planPx.x,y2:p.planPx.y,stroke:'var(--accent, #4878e8)','stroke-width':2,'stroke-dasharray':'5 4'}).forEach(([k,v])=>line.setAttribute(k,v));svg.append(line);
  });plan.prepend(svg);
}
function removeEditedCamera(id) {
  if (!canEditPlan() || !state.panoramas[id]) return false;
  flushHistorySoft();
  delete state.panoramas[id];
  Object.values(state.panoramas).forEach(p=>p.destinations=(p.destinations||[]).filter(d=>String(d.panoId)!==String(id)));
  state.levels.forEach(level=>(level.markers||[]).forEach(marker=>{if(String(marker.localPano)===String(id))delete marker.localPano}));
  if(state.startPano===id){state.startPano=null;state.startYaw=null}
  if(activeLocalPano===id)activeLocalPano=null;
  editedCameraId=null;cameraLinkSource=null;touch();render();renderMinimap();refreshCameraEditor();
  status('Камера удалена. Отмена: Ctrl/Cmd+Z');return true;
}
document.querySelector('#cameraEditorSelect').onchange=e=>{const id=e.target.value;selectCameraForEditing(id);const floor=state.panoramas[id]?.floorId;const index=state.levels.findIndex(l=>String(l.floorId)===String(floor));if(index>=0&&index!==state.active)selectLevel(index)};
document.querySelector('#cameraEditorLink').onclick=()=>{if(canEditPlan()&&editedCameraId){cameraLinkSource=cameraLinkSource?null:editedCameraId;refreshCameraEditor()}};
document.querySelector('#cameraEditorStart').onclick=()=>{if(canEditPlan()&&editedCameraId){setStartPano(state.startPano===editedCameraId?null:editedCameraId);refreshCameraEditor()}};
document.querySelector('#cameraEditorDelete').onclick=()=>{const id=editedCameraId;if(canEditPlan()&&id)ask('Удалить камеру «'+(state.panoramas[id].room||id)+'» и её переходы?',()=>removeEditedCamera(id),{yes:'Удалить',title:'Удаление камеры'})};
const cameraOriginalRender=renderPlanCameras;
renderPlanCameras=function(...args){cameraOriginalRender(...args);refreshCameraEditor()};
const cameraOriginalSyncTools=syncTools;
syncTools=function(...args){const result=cameraOriginalSyncTools(...args);refreshCameraEditor();return result};
const cameraOriginalApplyMode=applyMode;
applyMode=function(...args){const result=cameraOriginalApplyMode(...args);refreshCameraEditor();return result};
refreshCameraEditor();
