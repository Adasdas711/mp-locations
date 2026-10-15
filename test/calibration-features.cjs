const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../calibration-features.js');
function image(width=160,height=120,paint=()=>0){const pixels=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,v=paint(x,y);pixels[i]=pixels[i+1]=pixels[i+2]=v;pixels[i+3]=255}return {width,height,pixels}}
test('Automatic reference detection returns actual subpixel corners with broad spatial coverage',()=>{
 const points=F.detect({...image(160,120,(x,y)=>x>=30&&x<130&&y>=25&&y<95?240:15),count:4});assert.equal(points.length,4);
 for(const [x,y]of [[29.5,24.5],[129.5,24.5],[129.5,94.5],[29.5,94.5]])assert.ok(points.some(p=>Math.hypot(p.x-x,p.y-y)<.2),JSON.stringify(points));
});
test('Blank, low contrast and single-edge photographs never invent control points',()=>{
 for(const picture of [image(),image(160,120,()=>127),image(160,120,(x,y)=>x>80?220:20),image(160,120,(x,y)=>120+(x+y)%3)])assert.deepEqual(F.detect(picture),[]);
});
test('Corner selection is deterministic, bounded and ignores image borders',()=>{
 const picture=image(180,140,(x,y)=>((x<5||y<5)||x>30&&x<80&&y>35&&y<90)?255:0),first=F.detect({...picture,count:32});assert.deepEqual(F.detect({...picture,count:32}),first);assert.ok(first.length>=4&&first.length<=32);assert.ok(first.every(p=>p.x>8&&p.y>8&&p.x<172&&p.y<132));
});
test('Feature detector rejects oversized or malformed samples',()=>{
 for(const sample of [{width:12,height:12,pixels:[]},{width:512,height:513,pixels:[]},{width:20,height:20,pixels:new Uint8Array(5)}])assert.throws(()=>F.detect(sample),/Invalid reference image/);
});
test('Pair-aware suggestions require a uniquely matching detail in the other panorama',()=>{
 const reference={...image(160,120,(x,y)=>x>=30&&x<130&&y>=25&&y<95?240:15),pose:{yaw:0,pitch:0,fov:90}};
 const shared=F.matchVisible({reference,targets:[reference],count:4});assert.equal(shared.length,4);assert.ok(shared.every(p=>p.visibility==='image-supported'&&p.similarity>.99));
 assert.deepEqual(F.matchVisible({reference,targets:[{...image(160,120,()=>127),pose:reference.pose}],count:4}),[],'An opaque wall with no matching details cannot supply correspondences');
 assert.deepEqual(F.matchVisible({reference,targets:[reference,{...reference,pose:{yaw:90,pitch:0,fov:90}}],count:4}),[],'Repeated details in different directions are ambiguous');
});
const camera=(x,y,z)=>({position:{x,y,z},rotation:{x:0,y:0,z:0,w:1}});
const plane={positions:[-3,-3,-4,3,-3,-4,3,3,-4,-3,3,-4],indices:[0,1,2,0,2,3]};
test('Geometry rejects landmarks on the other face of a wall and through an intervening wall',()=>{
 const point={yaw:0,pitch:0},left=camera(0,0,0);
 assert.equal(F.visibility(point,{left,right:camera(1,0,0),geometry:plane}).visible,true);
 const backside=F.visibility(point,{left,right:camera(0,0,-5),geometry:plane});assert.equal(backside.visible,false);assert.equal(backside.reason,'opposite-wall-face');
 const geometry={positions:[...plane.positions,.5,-2,-4,.5,2,-4,.5,2,-2,.5,-2,-2],indices:[...plane.indices,4,5,6,4,6,7]};
 const blocked=F.visibility(point,{left,right:camera(1,0,-3),geometry});assert.equal(blocked.visible,false);assert.equal(blocked.reason,'wall-occlusion');
});
test('Depth-map occlusion uses radial depth; unknown geometry never becomes known visibility',()=>{
 const point={yaw:0,pitch:0},left=camera(0,0,0),right=camera(1,0,0),depth=value=>({width:4,height:3,data:Array(12).fill(value),scale:1});
 assert.equal(F.visibility(point,{left,right}).visible,null);
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(4)}).visible,null);
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(4),rightDepth:depth(2)}).reason,'depth-occlusion');
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(4),rightDepth:depth(Math.sqrt(17))}).visible,true);
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(8),geometry:plane}).reason,'geometry-depth-conflict');
});
test('Empty or missed geometry and incompatible surface depth do not prove visibility',()=>{
 const left=camera(0,0,0),right=camera(1,0,0),point={yaw:0,pitch:0},depth=value=>({width:4,height:3,data:Array(12).fill(value)});
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(4),geometry:{positions:[],indices:[]}}).visible,null);
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(4),rightDepth:depth(8)}).visible,null);
 assert.equal(F.visibility(point,{left,right,leftDepth:depth(4),rightDepth:depth(Math.sqrt(17))}).visible,true);
 for(const value of [NaN,Infinity,-1,0])assert.equal(F.visibility(point,{left,right,leftDepth:depth(value)}).visible,null);
});
test('Depth at a wall surface must not disable the opposite-face test',()=>{
 const depth={width:4,height:3,data:Array(12).fill(4)},result=F.visibility({yaw:0,pitch:0},{left:camera(0,0,0),right:camera(0,0,-5),geometry:plane,leftDepth:depth});assert.equal(result.visible,false);assert.equal(result.reason,'opposite-wall-face');
});
test('Rotated camera depth rays identify actual surfaces and wrapped yaw consistently',()=>{
 const q={x:0,y:Math.sin(Math.PI/4),z:0,w:Math.cos(Math.PI/4)},left={position:{x:0,y:0,z:0},rotation:q},right=camera(0,0,1),depth={width:4,height:3,data:Array(12).fill(4)},p={yaw:360,pitch:0},result=F.visibility(p,{left,right,leftDepth:depth,rightDepth:{...depth,data:Array(12).fill(Math.sqrt(17))}});
 assert.equal(result.visible,true);assert.ok(Math.abs(result.rightHint.yaw-Math.atan2(4,1)*180/Math.PI)<1e-6);assert.deepEqual(F.visibility({...p,yaw:0},{left,right,leftDepth:depth}),F.visibility(p,{left,right,leftDepth:depth}));
});

test('Ambiguous or absent target details never fall back to unsupported source corners',()=>{
 const reference={...image(160,120,(x,y)=>x>=30&&x<130&&y>=25&&y<95?240:15),pose:{yaw:0,pitch:0,fov:90}};
 for(const targets of [[reference,{...reference,pose:{yaw:90,pitch:0,fov:90}}],[{...image(160,120,()=>127),pose:reference.pose}]])assert.deepEqual(F.matchVisible({reference,targets,count:4,includeUnverified:true}),[],'Even an obsolete fallback flag cannot re-enable unverified automatic pins');
});
test('Occlusion tests are invariant under relative-world scale and depth holes stay unknown',()=>{
 for(const scale of [1e-5,1,1e5]){const geometry={positions:plane.positions.map(v=>v*scale),indices:plane.indices};assert.equal(F.visibility({yaw:0,pitch:0},{left:camera(0,0,0),right:camera(0,0,-5*scale),geometry,leftDepth:{width:4,height:3,data:Array(12).fill(4*scale)}}).visible,false)}
 assert.equal(F.visibility({yaw:0,pitch:0},{left:camera(0,0,0),right:camera(1,0,0),leftDepth:{width:4,height:3,data:Array(12).fill(4)},rightDepth:{width:4,height:3,data:Array(12).fill(0)}}).visible,null);
});
test('A doorway or exposed wall edge is not falsely rejected as the hidden interior face',()=>{
 const context={left:camera(0,0,0),right:camera(0,0,-5),geometry:plane},edge={yaw:Math.atan2(-3,4)*180/Math.PI,pitch:0};
 assert.equal(F.visibility({yaw:Math.atan2(-2.98,4)*180/Math.PI,pitch:0},context).visible,null,'A small measurement offset next to the exposed edge stays uncertain');assert.equal(F.visibility({yaw:Math.atan2(-2.8,4)*180/Math.PI,pitch:0},context).visible,false);assert.equal(F.visibility(edge,context).visible,null);assert.equal(F.visibility(edge,context).reason,'surface-boundary');
 assert.equal(F.visibility({yaw:0,pitch:0},context).visible,false,'A shared triangulation seam remains inside the wall');assert.equal(F.visibility({yaw:0,pitch:0},{...context,geometry:{positions:new Float32Array(plane.positions),indices:new Uint32Array(plane.indices)}}).visible,false);
});

test('Registered geometry cannot substitute for missing photographic evidence',()=>{
 const reference={...image(160,120,(x,y)=>x>=30&&x<130&&y>=25&&y<95?240:15),pose:{yaw:0,pitch:0,fov:90}};
 const result=F.matchVisible({reference,targets:[{...image(160,120,()=>127),pose:reference.pose}],geometryContext:{left:camera(0,0,0),right:camera(1,0,0),geometry:plane}});assert.equal(result.length,0);
});
