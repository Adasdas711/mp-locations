exports.activate = async function(api) {
  const subscription = api.tour.onAnchorClick(async ({anchor}) => {
    try { await api.ui.showMessage('Clicked: ' + anchor.label); }
    catch (error) { console.error(error); }
  });
  await subscription.ready;
  api.commands.register('example.place-anchor', async () => {
    const cameras = await api.tour.read();
    const ids = Object.keys(cameras);
    if (!ids.length) throw new Error('Open a palace with panoramas first.');
    await api.tour.select(ids[0]);
    await api.tour.waitForPanoramaReady(ids[0]);
    const hit = await api.tour.scene.raycast({
      screenPosition: {x:.5,y:.5}, distance:10
    });
    const anchor = await api.tour.anchors.create({
      panoId:ids[0], position:hit.position, label:'Example locus',
      style:{type:'sphere',color:'#3592c4',size:.4},
      metadata:{syntheticPlacement:hit.synthetic}
    });
    await api.tour.anchors.update(anchor.id, {
      position:{x:anchor.position.x+1,y:anchor.position.y,z:anchor.position.z}
    });
    await api.tour.camera.focusAnchor(anchor.id,{duration:600});
    const pose = await api.tour.camera.getPose();
    console.log(pose);
    await api.tour.playback.start({stops:ids.map(panoId=>({
      panoId, ...(panoId===anchor.panoId?{anchorId:anchor.id}:{}),
      duration:1000,hold:2000
    })),loop:false});
  });
};
