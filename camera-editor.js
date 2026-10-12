/* Unified camera editing. Selection never navigates away from the plan. */
let editedCameraId = null, cameraLinkSource = null;
const cameraEditor = document.createElement('section');
cameraEditor.id = 'cameraEditor';
cameraEditor.className = 'camera-editor-panel';
cameraEditor.setAttribute('aria-label', 'Редактирование камеры');
cameraEditor.innerHTML = `<header class="camera-editor-header"><strong>Камера</strong><span id="cameraEditorBadge"></span><button id="cameraEditorCollapse" type="button" aria-label="Свернуть панель" aria-expanded="true">−</button><button id="cameraEditorClose" type="button" aria-label="Закончить редактирование">×</button></header>
<div id="cameraEditorContent"><select id="cameraEditorSelect" aria-label="Выбрать камеру"></select><div class="camera-editor-actions"><button id="cameraEditorLink" type="button">Добавить связи</button><button id="cameraEditorStart" type="button">Начало</button></div><p id="cameraEditorHint" role="status"></p></div>`;
document.querySelector('#stage').append(cameraEditor);
let cameraEditorCollapsed = false;
const cameraStyle = document.createElement('style');
cameraStyle.textContent = `
#cameraEditor{position:absolute;display:flex!important;flex-direction:column!important;align-items:stretch!important;gap:0;left:76px;right:auto;bottom:12px;top:auto;width:min(260px,calc(100% - 92px));max-height:calc(100% - 24px);padding:0!important;overflow:hidden;z-index:35;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);box-shadow:0 4px 16px #0003;font:11px/1.4 system-ui;text-align:left}
#cameraEditor[hidden],#cameraEditorContent[hidden]{display:none!important}
#cameraEditor .camera-editor-header{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--line)}
#cameraEditor .camera-editor-header strong{flex:1;min-width:0;font-size:11px}#cameraEditorBadge{font-size:9px;color:var(--muted)}
#cameraEditorContent{padding:7px 8px;overflow:auto;min-height:0;display:block}
#cameraEditor select{box-sizing:border-box;display:block;width:100%;min-width:0;height:28px;padding:0 6px;border:1px solid var(--line);border-radius:4px;background:var(--vscode-input-bg,var(--panel));color:var(--text);font:inherit}
#cameraEditor button{box-sizing:border-box;display:flex;align-items:center;justify-content:center;min-width:0;min-height:28px;padding:4px 7px;border:1px solid var(--line);border-radius:4px;background:var(--elev,var(--panel));color:var(--text);font:inherit;white-space:nowrap;cursor:pointer}
#cameraEditor button:disabled{opacity:.4;cursor:default}#cameraEditor button:focus-visible,#cameraEditor select:focus-visible,.camera-action:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
#cameraEditor .camera-editor-header button{width:22px;min-height:22px;padding:0;background:transparent;border-color:transparent;font-size:16px}
#cameraEditor .camera-editor-actions{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:5px;margin-top:6px}
#cameraEditorLink{background:var(--vscode-button-bg)!important;color:#fff!important;border-color:transparent!important}
#cameraEditorStart[aria-pressed=true]{border-color:var(--blue);color:var(--blue)}
#cameraEditorHint{margin:5px 0 0;font-size:10px;line-height:1.35;color:var(--muted)}
.tool-camera #plan .plan-cam{cursor:grab}.tool-camera #plan .plan-cam.dragging{cursor:grabbing}
.tool-camera #plan .plan-cam.camera-edit-selected{outline:3px solid var(--blue)!important;outline-offset:4px;background:var(--vscode-button-bg)!important;color:#fff!important;z-index:5}
.tool-camera #plan .plan-cam.camera-edit-connected{outline:2px solid var(--blue)!important;outline-offset:2px;box-shadow:0 0 0 5px color-mix(in srgb,var(--blue) 20%,transparent)!important;z-index:4}
#plan .plan-cam .camera-action{position:absolute;right:-8px;top:-9px;display:flex;align-items:center;justify-content:center;width:22px;height:22px;min-width:22px;min-height:22px;padding:0;border:1.5px solid var(--panel);border-radius:50%;background:var(--vscode-button-bg);color:#fff;font:700 16px/1 system-ui;cursor:pointer;z-index:8;box-shadow:0 1px 4px #0005;transform:rotate(var(--mrot,0deg)) scale(var(--camera-action-scale,1));transform-origin:center}
#plan .plan-cam .camera-action[data-action=remove-link]{background:var(--red);color:#fff}
#plan .plan-cam .camera-action[data-action=delete-camera]{background:var(--red);color:#fff;font-size:12px}
#plan .plan-cam .camera-action .ic{width:12px;height:12px}
.camera-link-lines{position:absolute;inset:0;display:block;width:100%;height:100%;max-width:none;overflow:visible;pointer-events:none;z-index:1}
.camera-link-lines line{stroke:var(--blue);stroke-width:2;stroke-dasharray:6 5;opacity:.5;vector-effect:non-scaling-stroke;filter:drop-shadow(0 1px 1px #0007)}
.camera-link-lines line.selected{stroke-width:3;opacity:1}
.tool-camera #markerCtl{display:none}
@media(max-width:600px){#cameraEditor{left:8px;right:8px;bottom:8px;width:auto;max-height:32%}#cameraEditorContent{padding:6px 8px}#cameraEditor .camera-editor-actions button{min-height:32px}#plan .plan-cam .camera-action{width:26px;height:26px;min-width:26px;min-height:26px;right:-10px;top:-10px}}
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
  cameraEditor.hidden = state.tool !== 'camera' || !canEditPlan();
  const panos=state.panoramas||{};
  if(cameraEditor.hidden)cameraLinkSource=null;
  else {
    const ids=level()?panoramasForLevel(level()):[];
    if(!panos[editedCameraId]||!cameraLinkSource&&!ids.includes(editedCameraId))editedCameraId=ids.includes(activeLocalPano)?activeLocalPano:ids[0]||null;
    if(!panos[cameraLinkSource])cameraLinkSource=null;
    document.querySelector('#cameraEditorContent').hidden=cameraEditorCollapsed;
    const collapse=document.querySelector('#cameraEditorCollapse');collapse.setAttribute('aria-expanded',String(!cameraEditorCollapsed));collapse.title=cameraEditorCollapsed?'Развернуть панель':'Свернуть панель';collapse.setAttribute('aria-label',collapse.title);collapse.textContent=cameraEditorCollapsed?'+':'−';
    document.querySelector('#cameraEditorBadge').textContent=editedCameraId&&state.startPano===editedCameraId?'Начальная':'';
    const select=document.querySelector('#cameraEditorSelect');select.replaceChildren(new Option('Выбрать камеру',''));Object.entries(panos).forEach(([id,p])=>select.add(new Option(p.room||id,id)));select.value=editedCameraId||'';
    document.querySelector('#cameraEditorHint').textContent=cameraLinkSource?'Нажмите камеру или «+». Esc — отмена.':editedCameraId?'«+» добавить связь · «−» удалить.':'Выберите камеру на плане.';
    for(const name of ['Link','Start'])document.querySelector('#cameraEditor'+name).disabled=!editedCameraId;
    const link=document.querySelector('#cameraEditorLink');link.textContent=cameraLinkSource?'Отмена':'Добавить связи';link.setAttribute('aria-pressed',String(!!cameraLinkSource));
    const start=document.querySelector('#cameraEditorStart');start.textContent='Начало';start.setAttribute('aria-pressed',String(!!editedCameraId&&state.startPano===editedCameraId));start.title=start.getAttribute('aria-pressed')==='true'?'Снять начальную камеру':'Сделать начальной';
  }
  document.querySelectorAll('#plan .plan-cam').forEach(node=>{
    const id=node.dataset.pano,selected=!cameraEditor.hidden&&id===editedCameraId,connected=!cameraEditor.hidden&&!!editedCameraId&&id!==editedCameraId&&(linkedCamera(editedCameraId,id)||linkedCamera(id,editedCameraId));
    node.classList.toggle('camera-edit-selected',selected);node.classList.toggle('camera-edit-connected',connected);node.setAttribute('aria-pressed',String(selected));
    const zoom=state.zoom||1;node.style.setProperty('--camera-action-scale',String(1/zoom));
    const base=Math.max(20,Math.round(1.24*markerSize())),size=!cameraEditor.hidden&&window.PALACE_MOBILE?.phone?Math.max(base,32/zoom):base;node.style.width=node.style.height=size+'px';
    node.querySelector('.camera-action')?.remove();
    if(cameraEditor.hidden)return;
    node.title='Камера: '+(panos[id]?.room||id);
    if(!editedCameraId)return;
    const button=document.createElement('button');button.type='button';button.className='camera-action';button.dataset.target=id;
    button.dataset.action=selected?'delete-camera':connected?'remove-link':'add-link';
    if(selected){button.id='cameraEditorDelete';button.title='Удалить камеру';button.innerHTML='<svg class="ic"><use href="#i-trash"/></svg>'}
    else {button.textContent=connected?'−':'+';button.title=(connected?'Удалить переход: ':'Добавить переход: ')+(panos[id]?.room||id)}
    button.setAttribute('aria-label',button.title);
    ['pointerdown','pointerup','mousedown','mouseup','keydown','contextmenu'].forEach(type=>button.addEventListener(type,event=>event.stopPropagation()));
    button.onclick=event=>{event.stopPropagation();if(!canEditPlan())return;if(selected)requestCameraDeletion(id);else{changeCameraTransition(editedCameraId,id,!connected);cameraLinkSource=null;refreshCameraEditor()}};
    node.append(button);
  });
  renderCameraPlanLinks();
}
function requestCameraDeletion(id){if(canEditPlan()&&state.panoramas[id])ask('Удалить камеру «'+(state.panoramas[id].room||id)+'» и её переходы?',()=>removeEditedCamera(id),{yes:'Удалить',title:'Удаление камеры'})}
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
document.querySelector('#cameraEditorSelect').onchange=e=>{const id=e.target.value,floor=state.panoramas[id]?.floorId,index=state.levels.findIndex(l=>String(l.floorId)===String(floor));if(!cameraLinkSource&&index>=0&&index!==state.active)selectLevel(index);selectCameraForEditing(id)};
document.querySelector('#cameraEditorLink').onclick=()=>{if(canEditPlan()&&editedCameraId){cameraLinkSource=cameraLinkSource?null:editedCameraId;refreshCameraEditor()}};
document.querySelector('#cameraEditorStart').onclick=()=>{if(canEditPlan()&&editedCameraId){setStartPano(state.startPano===editedCameraId?null:editedCameraId);refreshCameraEditor()}};
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

const cameraApplyLayout=applyLayout;
applyLayout=function(...args){const result=cameraApplyLayout(...args);if(state.layout!=='split'&&state.layout!=='split-rev'){document.querySelectorAll('#plan .plan-view-cone').forEach(node=>node.remove());planCone.el=null;planCone.path=null;}refreshCameraEditor();return result};

window.openCameraTool=async function(){
  if(!canEditPlan())return;
  state.tool='camera';state.layout='plan';cameraEditorCollapsed=false;
  await setPlanView('2d',true);applyLayout();syncTools();drawPlan();refreshCameraEditor();
};

const cameraApplyZoom=applyZoom;applyZoom=function(...args){const result=cameraApplyZoom(...args);if(state.tool==='camera')refreshCameraEditor();return result};
const cameraFitPlanView=fitPlanView;fitPlanView=function(...args){const result=cameraFitPlanView(...args);if(result&&state.tool==='camera')refreshCameraEditor();return result};
