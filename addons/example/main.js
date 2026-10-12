const {escape}=require('./utils');
exports.activate=api=>{
 api.commands.register('palace.example.summary',async()=>{
  const project=await api.project.read();
  const count=project.levels.reduce((n,floor)=>n+floor.markers.length,0);
  await api.ui.showPanel('palace.example.panel',`<h2>${escape(project.name)}</h2><p>Floors: ${project.levels.length}</p><p>Loci: ${count}</p><p>Cameras: ${project.panoramas.length}</p>`);
 });
 api.commands.register('palace.example.center',async()=>{
  const project=await api.project.read(),floor=project.levels[project.active];
  if(!floor)throw new Error("Add a floor plan first.");
  await api.markers.add({level:floor.index,x:floor.w/2,y:floor.h/2,note:"Created by plugin"});
  await api.ui.showMessage("Locus added at the center of the floor");
 });
};
