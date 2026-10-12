/* Versioned extension boundary. The editor's internal globals stay private to this adapter. */
'use strict';
window.PalaceAPI=Object.freeze({
 version:'1.0.0',
 readProject(){
  const serial=buildSerializableState();
  // Image and panorama bytes are not part of the read API.
  return structuredClone({name:serial.name,purpose:serial.purpose,source:serial.source,explain:serial.explain,notes:serial.notes,active:state.active,mode:state.mode,levels:serial.levels.map((level,index)=>({index,name:level.name,w:level.w,h:level.h,floorId:level.floorId,markers:level.markers})),panoramas:Object.entries(state.panoramas).map(([id,p])=>({id,room:p.room,floorId:p.floorId,planPx:p.planPx,destinations:p.destinations}))});
 },
 updateMetadata(patch){
  if(!canEditPlan())throw new Error("Switch to edit mode.");
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error("A metadata object is required.");
  for(const [key,value]of Object.entries(patch)){
   if(!['name','purpose','source','explain','notes'].includes(key)||typeof value!=='string'||value.length>50000)throw new Error("Invalid metadata field: "+key);
  }
  Object.assign(state,patch);touch();render();return this.readProject();
 },
 addMarker(input){
  if(!canEditPlan())throw new Error("Switch to edit mode.");
  if(!input||!Number.isInteger(input.level)||!state.levels[input.level])throw new Error("Floor not found.");
  const floor=state.levels[input.level];
  if(!Number.isFinite(input.x)||!Number.isFinite(input.y)||input.x<0||input.y<0||input.x>floor.w||input.y>floor.h)throw new Error("The locus must be inside the plan.");
  if(input.note!=null&&(typeof input.note!=='string'||input.note.length>50000))throw new Error("Invalid note.");
  if(floor.markers.length>=100)throw new Error("Maximum number of loci on this floor reached.");
  floor.markers.push({x:input.x,y:input.y,note:input.note||''});touch();render();return {level:input.level,index:floor.markers.length-1};
 },
 removeMarker(input){
  if(!canEditPlan())throw new Error("Switch to edit mode.");
  if(!input||!Number.isInteger(input.level)||!Number.isInteger(input.index)||!state.levels[input.level]?.markers[input.index])throw new Error("Locus not found.");
  const floor=state.levels[input.level];floor.markers.splice(input.index,1);floor.selected=null;touch();render();return true;
 },
 theme(){const style=getComputedStyle(document.documentElement);return {name:getTheme(),background:style.getPropertyValue('--vscode-editor-bg').trim(),foreground:style.getPropertyValue('--vscode-fg').trim(),accent:style.getPropertyValue('--vscode-focus').trim()};},
 notify(message){if(typeof message!=='string'||message.length>2000)throw new Error("Invalid message.");status(message);return true;}
});
