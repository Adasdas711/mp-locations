/* Heavy numerical work never executes on the editor's main thread. */
'use strict';
if(typeof importScripts==='function'){
 importScripts('calibration-math.js');
 self.onmessage=event=>{try{self.postMessage({id:event.data.id,result:PalaceCalibrationMath.calculate(event.data.session,event.data.context)})}catch(error){self.postMessage({id:event.data.id,error:String(error.message||error)})}};
}else if(typeof require==='function'){
 const {parentPort}=require('node:worker_threads'),math=require('./calibration-math.js');
 parentPort.on('message',data=>{try{parentPort.postMessage({id:data.id,result:math.calculate(data.session,data.context)})}catch(error){parentPort.postMessage({id:data.id,error:String(error.message||error)})}});
}
