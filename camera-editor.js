/* Unified camera editing. Selection never navigates away from the plan. */
let editedCameraId = null, cameraLinkSource = null;
const cameraEditor = document.createElement('section');
cameraEditor.id = 'cameraEditor';
cameraEditor.className = 'canvas-ctl';
cameraEditor.setAttribute('aria-label', 'Редактирование камеры');
cameraEditor.innerHTML = `<header class="camera-editor-header"><strong>Камеры</strong><span id="cameraEditorBadge"></span>
<button id="cameraEditorCollapse" type="button" title="Свернуть панель" aria-label="Свернуть панель" aria-expanded="true"><svg class="ic"><use href="#i-minus"/></svg></button>
<button id="cameraEditorClose" type="button" title="Закончить редактирование" aria-label="Закончить редактирование"><svg class="ic"><use href="#i-close"/></svg></button></header>
<div id="cameraEditorContent"><label for="cameraEditorSelect">Выбранная камера</label><select id="cameraEditorSelect" aria-label="Выбрать камеру"></select>
<div class="camera-editor-actions"><button id="cameraEditorLink" type="button">Связать</button><button id="cameraEditorStart" type="button">Начальная</button>
<button id="cameraEditorDelete" type="button" title="Удалить камеру" aria-label="Удалить камеру"><svg class="ic"><use href="#i-trash"/></svg></button></div>
<p id="cameraEditorHint" role="status"></p><details id="cameraEditorConnections" open><summary>Переходы <span id="cameraEditorCount">0</span></summary><div id="cameraEditorLinks"></div></details></div>`;
document.querySelector('#stage').append(cameraEditor);
cameraEditor.querySelector('#cameraEditorConnections').open=!matchMedia('(max-width:600px)').matches;
let cameraEditorCollapsed = false;
const cameraStyle = document.createElement('style');
cameraStyle.textContent = `
#cameraEditor{position:absolute;display:flex;flex-direction:column;align-items:stretch;gap:0;left:76px;right:auto;bottom:12px;top:auto;width:min(304px,calc(100% - 92px));max-width:none;max-height:calc(100% - 24px);padding:0;overflow:hidden;z-index:35;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);box-shadow:0 6px 24px #0003;font-size:calc(12px*var(--ui-k,1));text-align:left}
#cameraEditor[hidden],#cameraEditorContent[hidden]{display:none!important}
#cameraEditor .camera-editor-header{display:flex;align-items:center;gap:6px;padding:9px 10px;border-bottom:1px solid var(--line);flex:none}
#cameraEditor .camera-editor-header strong{flex:1;min-width:0;font-size:calc(13px*var(--ui-k,1))}
#cameraEditorBadge{font-size:10px;color:var(--muted);white-space:nowrap}
#cameraEditorContent{padding:10px 12px;overflow:auto;min-height:0;display:block}
#cameraEditor label{display:block;white-space:normal;color:var(--muted);font-size:11px;margin:0 0 5px}
#cameraEditor select{box-sizing:border-box;display:block;width:100%;min-width:0;height:36px;padding:0 9px;border:1px solid var(--vscode-input-border,var(--line));border-radius:6px;background:var(--vscode-input-bg,var(--panel));color:var(--text);font:inherit;text-overflow:ellipsis}
#cameraEditor button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:6px;min-height:34px;min-width:0;padding:6px 9px;border:1px solid var(--line);border-radius:6px;background:var(--elev,var(--panel));color:var(--text);font:inherit;white-space:nowrap;cursor:pointer}
#cameraEditor button:hover:not(:disabled){border-color:var(--blue);background:var(--vscode-list-hover)}
#cameraEditor button:focus-visible,#cameraEditor select:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
#cameraEditor button:disabled{opacity:.4;cursor:default}
#cameraEditor .camera-editor-header button{width:28px;min-height:28px;padding:4px;border-color:transparent;background:transparent}
#cameraEditor .ic{width:16px;height:16px;flex:none}
#cameraEditor .camera-editor-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 36px;gap:6px;margin-top:8px}
#cameraEditorLink{background:var(--vscode-button-bg)!important;color:var(--t-btnFg,#fff)!important;border-color:transparent!important}
#cameraEditorStart[aria-pressed=true]{border-color:var(--blue);color:var(--blue)}
#cameraEditorDelete{color:var(--red)!important}
#cameraEditorHint{margin:8px 0 10px;font-size:11px;line-height:1.45;color:var(--muted);white-space:normal}
#cameraEditorConnections{display:block;border-top:1px solid var(--line);padding-top:8px}
#cameraEditorConnections summary{cursor:pointer;font-size:11px;color:var(--muted);user-select:none}
#cameraEditorCount{float:right;min-width:18px;text-align:center;border-radius:8px;background:var(--elev);font-size:10px}
#cameraEditorLinks{display:block;max-height:120px;overflow:auto;margin-top:6px}
#cameraEditorLinks .camera-link-row{display:flex;align-items:center;gap:8px;min-height:32px;border-bottom:1px solid var(--line)}
#cameraEditorLinks .camera-link-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#cameraEditorLinks .camera-link-floor{font-size:10px;color:var(--muted);flex:none}
#cameraEditorLinks button{width:28px;min-height:28px;padding:5px;flex:none;border-color:transparent;background:transparent;color:var(--muted)}
#cameraEditorLinks button:hover{color:var(--red)}
.camera-edit-selected{outline:3px solid var(--blue);outline-offset:3px}
.camera-link-lines{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;overflow:visible;pointer-events:none;z-index:1}
.camera-link-lines line{stroke:var(--t-focus,var(--blue));stroke-width:1.7;stroke-dasharray:6 5;opacity:.55;vector-effect:non-scaling-stroke;filter:drop-shadow(0 1px 1px #0007)}
.camera-link-lines line.selected{stroke-width:2.5;opacity:1}
.tool-camera #markerCtl{display:none}
.tool-camera .plan-cam{cursor:grab}.tool-camera .plan-cam.dragging{cursor:grabbing}
@media(max-width:600px){#cameraEditor{left:8px;right:8px;bottom:8px;width:auto;max-height:42%;border-radius:9px}#cameraEditorContent{padding:8px 10px}#cameraEditor .camera-editor-header{padding:6px 10px}#cameraEditorLinks{max-height:72px}#cameraEditorHint{margin:6px 0;font-size:10px}#cameraEditor .camera-editor-actions{grid-template-columns:minmax(0,1fr) minmax(0,1fr) 40px}#cameraEditor .camera-editor-actions button{min-height:38px}}
`;
document.head.append(cameraStyle);
async function openCameraEditor(id, link = false) {
  if (!canEditPlan() || !state.panoramas[id]) return false;
  cameraLinkSource = null;
  cameraEditorCollapsed = false;
  state.tool = 'camera';
  const floor = state.panoramas[id].floorId;
  const index = state.levels.findIndex(l => String(l.floorId) === String(floor));
  if (index >= 0 && index !== state.active) selectLevel(index);
  state.layout = 'plan';
  await setPlanView('2d');
  applyLayout();syncTools();drawPlan();
  selectCameraForEditing(String(id));
  if (link) cameraLinkSource = String(id);
  refreshCameraEditor();
  return true;
}
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
  renderCameraPlanLinks();
  cameraEditor.hidden = state.tool !== 'camera' || !canEditPlan();
  if (cameraEditor.hidden) { cameraLinkSource = null; return; }
  const panos = state.panoramas || {};
  if (!panos[editedCameraId]) editedCameraId = null;
  if (!panos[cameraLinkSource]) cameraLinkSource = null;
  document.querySelector('#cameraEditorContent').hidden = cameraEditorCollapsed;
  const collapse=document.querySelector('#cameraEditorCollapse');
  collapse.setAttribute('aria-expanded',String(!cameraEditorCollapsed));
  collapse.title=cameraEditorCollapsed?'Развернуть панель':'Свернуть панель';collapse.setAttribute('aria-label',collapse.title);
  collapse.querySelector('use').setAttribute('href',cameraEditorCollapsed?'#i-plus':'#i-minus');
  document.querySelector('#cameraEditorBadge').textContent=cameraLinkSource?'Выберите вторую':editedCameraId&&state.startPano===editedCameraId?'Начальная':'';
  const select = document.querySelector('#cameraEditorSelect');
  select.replaceChildren(new Option('Выберите камеру на плане', ''));
  Object.entries(panos).forEach(([id,p]) => select.add(new Option(p.room || id,id)));
  select.value = editedCameraId || '';
  document.querySelector('#cameraEditorHint').textContent = cameraLinkSource
    ? 'Нажмите вторую камеру на плане. Esc — отмена.'
    : editedCameraId ? 'Камеру можно перетащить по плану.' : 'Выберите камеру на плане или в списке.';
  ['Link','Start','Delete'].forEach(name => document.querySelector('#cameraEditor'+name).disabled = !editedCameraId);
  document.querySelector('#cameraEditorLink').textContent = cameraLinkSource ? 'Отмена' : 'Связать';
  document.querySelector('#cameraEditorLink').setAttribute('aria-pressed',String(!!cameraLinkSource));
  const start = document.querySelector('#cameraEditorStart');
  start.textContent='Начальная';start.setAttribute('aria-pressed',String(!!editedCameraId&&state.startPano===editedCameraId));
  start.title=state.startPano===editedCameraId?'Снять назначение начальной камеры':'Сделать начальной камерой';
  const list = document.querySelector('#cameraEditorLinks');list.replaceChildren();let count=0;
  if (editedCameraId) Object.entries(panos).forEach(([id,p]) => {
    if (id === editedCameraId || !(linkedCamera(editedCameraId,id)||linkedCamera(id,editedCameraId))) return;
    count++;
    const row=document.createElement('div');row.className='camera-link-row';
    const label=document.createElement('span');label.className='camera-link-label';label.textContent=p.room||id;label.title=p.room||id;
    row.append(label);
    if(p.floorId!==panos[editedCameraId].floorId){const floor=document.createElement('span');floor.className='camera-link-floor';floor.textContent=state.levels.find(l=>l.floorId===p.floorId)?.name||'Другой этаж';row.append(floor)}
    const button=document.createElement('button');button.type='button';button.dataset.target=id;button.title='Удалить переход: '+(p.room||id);button.setAttribute('aria-label',button.title);button.innerHTML='<svg class="ic"><use href="#i-close"/></svg>';
    button.onclick=()=>{changeCameraTransition(editedCameraId,id,false);refreshCameraEditor()};row.append(button);list.append(row);
  });
  document.querySelector('#cameraEditorCount').textContent=String(count);
  if(!count){const empty=document.createElement('p');empty.textContent=editedCameraId?'Переходов пока нет':'Камера не выбрана';empty.style.cssText='margin:6px 0;color:var(--muted);font-size:11px';list.append(empty)}
  document.querySelectorAll('#plan .plan-cam').forEach(node=>{
    node.classList.toggle('camera-edit-selected',node.dataset.pano===editedCameraId);
    node.setAttribute('aria-pressed',String(node.dataset.pano===editedCameraId));
    node.title='Редактировать: '+(panos[node.dataset.pano]?.room||node.dataset.pano);
  });
}
function renderCameraPlanLinks() {
  const plan=document.querySelector('#plan');if(!plan)return;
  plan.querySelector('.camera-link-lines')?.remove();
  if(reviewSession)return;
  const ids=new Set([...plan.querySelectorAll('.plan-cam')].map(node=>node.dataset.pano));
  const panos=state.panoramas||{},seen=new Set();
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('camera-link-lines');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('viewBox',`0 0 ${plan.offsetWidth} ${plan.offsetHeight}`);svg.setAttribute('preserveAspectRatio','none');
  for(const id of ids){const from=panos[id];if(!from?.planPx)continue;
    for(const destination of from.destinations||[]){const target=String(destination.panoId),to=panos[target];if(target===id||!ids.has(target)||!to?.planPx||from.floorId!==to.floorId)continue;
      const key=JSON.stringify([id,target].sort());if(seen.has(key))continue;seen.add(key);
      const line=document.createElementNS(svg.namespaceURI,'line');
      line.dataset.from=id;line.dataset.to=target;
      if(state.tool==='camera'&&canEditPlan()&&(id===editedCameraId||target===editedCameraId))line.classList.add('selected');
      Object.entries({x1:from.planPx.x,y1:from.planPx.y,x2:to.planPx.x,y2:to.planPx.y}).forEach(([key,value])=>line.setAttribute(key,value));svg.append(line);
    }
  }
  if(svg.childElementCount)plan.append(svg);
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
document.querySelector('#cameraEditorCollapse').onclick=()=>{cameraEditorCollapsed=!cameraEditorCollapsed;refreshCameraEditor()};
document.querySelector('#cameraEditorClose').onclick=()=>{cameraLinkSource=null;state.tool='select';syncTools();drawPlan()};
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&cameraLinkSource&&!document.querySelector('.modal.show')&&!event.target.closest('input,textarea,select,[contenteditable]')){event.preventDefault();event.stopPropagation();cameraLinkSource=null;refreshCameraEditor()}},true);
const cameraOriginalRender=renderPlanCameras;
renderPlanCameras=function(...args){cameraOriginalRender(...args);refreshCameraEditor()};
const cameraOriginalSyncTools=syncTools;
syncTools=function(...args){const result=cameraOriginalSyncTools(...args);refreshCameraEditor();return result};
const cameraOriginalApplyMode=applyMode;
applyMode=function(...args){const result=cameraOriginalApplyMode(...args);refreshCameraEditor();return result};
refreshCameraEditor();

window.moveCameraPlanLinks=function(id,point){
  document.querySelectorAll('#plan .camera-link-lines line').forEach(line=>{
    if(line.dataset.from===String(id)){line.setAttribute('x1',point.x);line.setAttribute('y1',point.y)}
    if(line.dataset.to===String(id)){line.setAttribute('x2',point.x);line.setAttribute('y2',point.y)}
  });
};
