/* No UI. Require this helper from an addon module and supply your own measured bearings. */
exports.reconstruct = async function(api, {cameraIds, landmarks, distances=[], referenceCameraId=cameraIds[0], timeoutMs=60000}) {
  const calibration = api.tour.world.calibration;
  const session = await calibration.createSession({cameraIds,referenceCameraId,distances,automaticSolve:false,timeoutMs});
  let submitted=false, resolveResult, rejectResult, timer;
  const result = new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject});
  // Avoid an unhandled rejection while the asynchronous request is being submitted.
  result.catch(()=>{});
  const solved = calibration.onCalibrationSolved(event=>{
    if (submitted && event.sessionId===session.id) resolveResult(event);
  });
  const failed = calibration.onCalibrationFailed(event=>{
    if (submitted && event.sessionId===session.id) rejectResult(new Error(event.error?.message || 'Calibration failed'));
  });
  const status = calibration.onCalibrationStatusChanged(event=>{
    if (submitted && event.sessionId===session.id && !event.pending && ['collecting','insufficient_data','degenerate','failed'].includes(event.status)) {
      rejectResult(new Error('Calibration status: '+event.status));
    }
  });
  try {
    await Promise.all([solved.ready,failed.ready,status.ready]);
    for (const landmark of landmarks) await calibration.addLandmark(session.id,landmark);
    submitted=true;
    timer=setTimeout(()=>rejectResult(new Error('Calibration completion timeout; inspect getStatus/getQuality')),timeoutMs+10000);
    await calibration.solve(session.id); // Receipt only; the worker result arrives through events.
    await result;
    return {
      session:await calibration.getSession(session.id),
      quality:await calibration.getQuality(session.id),
      preview:await calibration.preview(session.id)
    };
    // Deliberately do not apply: your addon must explicitly confirm and call apply(session.id).
  } finally {
    clearTimeout(timer);solved.dispose();failed.dispose();status.dispose();
  }
};
