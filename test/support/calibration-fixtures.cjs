const M=require('../../calibration-math.js'),m=M.math;
function fixture(count=3,points=40,{noise=0,outliers=0,baseline=1,rotationOnly=false,chain=false,upright=false}={}){
 const cameras={};for(let i=0;i<count;i++)cameras['c'+i]={C:[rotationOnly?0:i*baseline,.08*Math.sin(i*.4)*(rotationOnly?0:1),0],Q:M.rotationIncrement([upright?0:.02*i,.09*i,upright?0:-.01*i])};
 const landmarks=[];for(let j=0;j<points;j++){const p=[Math.sin(j*1.7)*4+.3,Math.cos(j*2.3)*2-.2,-3-(j%9)*.4];let ids=Object.keys(cameras);if(chain){const start=j%Math.max(1,count-2);p[0]+=start;ids=ids.slice(start,start+3)}const observations=ids.map((id,k)=>{const c=cameras[id],ray=m.unit(m.mv(m.transpose(c.Q),m.sub(p,c.C))),angles=M.angles(ray);if(noise){angles.yaw+=Math.sin(j*7+k)*noise;angles.pitch+=Math.cos(j*3+k)*noise}if(outliers&&k===1&&j<outliers){angles.yaw+=45+j;angles.pitch-=20}return {panoId:id,...angles,verified:true}});landmarks.push({id:'p'+j,enabled:true,observations})}
 return {session:{id:'test',cameraIds:Object.keys(cameras),landmarks,config:{referenceCameraId:'c0',bundleIterations:40}},cameras,landmarks};
}
module.exports={fixture};
