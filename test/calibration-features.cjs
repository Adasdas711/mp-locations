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
