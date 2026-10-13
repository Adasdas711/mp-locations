let clickSubscription;
exports.activate = async function(api) {
  const cameras = {
    'demo-a': {x:-2,y:1.6,z:2},
    'demo-b': {x:2,y:1.6,z:2},
    'demo-c': {x:0,y:1.6,z:0}
  };
  const input = {
    position:{x:0,y:1.2,z:-2}, rotation:{x:0,y:0,z:0,w:1},
    scale:{x:1,y:1,z:1}, label:'One shared locus',
    style:{type:'sphere',color:'#ff4040',size:.35},
    metadata:{name:'Single world-space sphere',syntheticPlacement:false}
  };
  async function checkDemo() {
    const project = await api.project.read();
    if (project.name !== 'Shared World Demo') throw new Error('Open the accompanying shared-world-demo.mpalace first. Demo capture poses must not be applied to unrelated photos.');
  }
  async function create() {
    await checkDemo();
    for (const [id,position] of Object.entries(cameras)) {
      await api.tour.world.setCameraTransform(id, {position,rotation:{x:0,y:0,z:0,w:1},fov:75});
    }
    await api.tour.world.configure({units:'meters'});
    let existing;
    try { existing = await api.tour.world.objects.get('demo-locus'); }
    catch (error) { if (!error.message.includes('OBJECT_NOT_FOUND')) throw error; }
    return existing
      ? api.tour.world.objects.update('demo-locus', input)
      : api.tour.world.objects.create({id:'demo-locus',...input});
  }
  async function view(id) {
    await checkDemo();
    const object = await api.tour.world.objects.get('demo-locus');
    await api.tour.select(id);
    await api.tour.waitForPanoramaReady(id);
    await api.tour.camera.lookAt(await api.tour.world.worldToLocal(object.position,id), {duration:600});
  }
  api.commands.register('example.shared-world.create', create);
  for (const id of Object.keys(cameras)) api.commands.register('example.shared-world.'+id.at(-1), () => view(id));
  clickSubscription = api.tour.world.onObjectClicked(async ({object,panoId}) => {
    try { await api.ui.showMessage(object.label+' viewed from '+panoId); }
    catch (error) { console.error(error); }
  });
  await clickSubscription.ready;
};
exports.deactivate = function() { clickSubscription?.dispose(); };
