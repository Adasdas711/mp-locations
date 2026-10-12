/* Deliver deliberate touch taps on buttons when the browser suppresses a compatibility click after a drag. */
'use strict';
let mobileButtonPress=null,mobilePendingTap=null,mobileReplayedTap=null;
document.addEventListener('pointerdown',event=>{
 if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
 const button=event.target.closest?.('button');
 mobileButtonPress=button&&!button.disabled?{button,id:event.pointerId,x:event.clientX,y:event.clientY,time:Date.now(),moved:false}:null;
},true);
document.addEventListener('pointermove',event=>{
 if(mobileButtonPress?.id===event.pointerId&&Math.hypot(event.clientX-mobileButtonPress.x,event.clientY-mobileButtonPress.y)>9)mobileButtonPress.moved=true;
},true);
document.addEventListener('pointercancel',event=>{if(mobileButtonPress?.id===event.pointerId)mobileButtonPress=null},true);
document.addEventListener('pointerup',event=>{
 const press=mobileButtonPress;if(!press||press.id!==event.pointerId)return;mobileButtonPress=null;
 if(press.moved||Date.now()-press.time>500||!press.button.contains(event.target))return;
 clearTimeout(mobilePendingTap?.timer);
 const tap={button:press.button,x:event.clientX,y:event.clientY,native:false};mobilePendingTap=tap;
 tap.timer=setTimeout(()=>{
  if(tap.native||!tap.button.isConnected||tap.button.disabled)return;
  mobileReplayedTap={button:tap.button,until:Date.now()+400};
  tap.button.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:tap.x,clientY:tap.y,button:0,detail:1}));
 },80);
},true);
window.addEventListener('click',event=>{
 if(!event.isTrusted)return;
 const button=event.target.closest?.('button');
 if(mobileReplayedTap?.button===button&&Date.now()<mobileReplayedTap.until){event.preventDefault();event.stopImmediatePropagation();mobileReplayedTap=null;return}
 if(mobilePendingTap?.button===button){mobilePendingTap.native=true;clearTimeout(mobilePendingTap.timer)}
},true);
// Small touch screens hide a few desktop buttons; expose their actions in a compact menu.
const mobileMoreButton=document.createElement('button');mobileMoreButton.type='button';mobileMoreButton.id='mobileMore';mobileMoreButton.className='abtn';mobileMoreButton.title='Ещё';mobileMoreButton.setAttribute('aria-label','Ещё');mobileMoreButton.innerHTML='<svg class="ic"><use href="#i-gear"/></svg>';
document.querySelector('#abHotkeys').before(mobileMoreButton);
const mobileControlsStyle=document.createElement('style');mobileControlsStyle.textContent='#mobileMore{display:none}html.touch #mobileMore{display:inline-flex}';document.head.appendChild(mobileControlsStyle);
mobileMoreButton.onclick=()=>{const box=mobileMoreButton.getBoundingClientRect();showCtxMenu(box.left,Math.max(0,box.top-200),[
 {label:'Загрузить планы',icon:'upload',disabled:!canEditPlan(),run:()=>openPlansModal()},
 {label:'Горячие клавиши',icon:'keyboard',run:()=>openHotkeys()},
 {label:'Повернуть план…',icon:'rotate',disabled:!canEditPlan(),run:()=>ask('Угол поворота в градусах',value=>{const angle=Number(value);if(Number.isFinite(angle))applyRotation(angle)},{input:String(state.rotation),yes:'Применить'})},
 {label:'Размер локусов…',icon:'pin',disabled:!canEditPlan(),run:()=>ask('Размер локусов: 20–100',value=>{const size=Number(value);if(!Number.isFinite(size))return;state.markerSize=Math.max(20,Math.min(100,Math.round(size)));touch();render()},{input:String(markerSize()),yes:'Применить'})}
],'Ещё')};
