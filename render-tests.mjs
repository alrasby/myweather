import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {writeFileSync,mkdirSync} from 'node:fs';
import {createServer} from './project/node_modules/vite/dist/node/index.js';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/@napi-rs/canvas');
const server=await createServer({root:process.cwd()+'/project',configFile:process.cwd()+'/project/vite.android.config.ts',server:{middlewareMode:true}});
const {FieldEngine,shade}=await server.ssrLoadModule('/src/weather/glField.ts');
const {mercY,mercToLat}=await server.ssrLoadModule('/src/weather/grid.ts');
globalThis.window={devicePixelRatio:1};
globalThis.document={createElement(){const c=createCanvas(400,640);c.style={};return c;}};
const project=([lat,lon],z)=>({x:(lon+180)/360*256*2**z,y:(1-mercY(lat)/Math.PI)/2*256*2**z});
const unproject=([x,y],z)=>({lng:x/(256*2**z)*360-180,lat:mercToLat((1-y/(256*2**z)*2)*Math.PI)});
const map={getZoom:()=>5,getCenter:()=>({lat:24,lng:58}),getSize:()=>({x:400,y:640}),project,unproject,
containerPointToLatLng:([x,y])=>({lng:54+x/400*8,lat:mercToLat(mercY(30)-y/640*(mercY(18)-mercY(30))*-1)}),
latLngToContainerPoint:([lat,lon])=>({x:(lon-54)/8*400,y:(mercY(30)-mercY(lat))/(mercY(30)-mercY(18))*640})};
const e=new FieldEngine({});e.map=map;e.ctx2d=e.fieldCanvas.getContext('2d');
const n=8*12*2,arr=v=>new Float32Array(n).fill(v),g={id:'test',cols:8,rows:12,hours:2,south:18,north:30,west:54,lonSpan:8,full:false,times:[0,3600000],temp:arr(24),rain:arr(0),snow:arr(0),snowDepth:arr(0),cloud:arr(0),spd:arr(25),u:arr(25),v:arr(0),msl:arr(1013),ok:new Uint8Array(n).fill(1)};
for(let i=0;i<n;i++){const c=i%8;if(c<2)g.cloud[i]=95;else if(c<4){g.rain[i]=3;g.cloud[i]=90;}else if(c<6){g.snow[i]=1.5;g.cloud[i]=90;}else g.snowDepth[i]=0.2;}
e.global=g;e.rainWorld=g;e.kind=2;e.hourMax=1;e.drawField();mkdirSync('qa-render',{recursive:true});writeFileSync('qa-render/precip.png',e.fieldCanvas.toBuffer('image/png'));
const sample={temp:20,spd:25,u:25,v:0,dirFrom:270,dirTo:90,rain:0,cloud:0,snow:0,snowDepth:0};
assert.equal(shade(2,sample,[0,16],1),null);
const colors=[shade(2,{...sample,cloud:95},[0,16],1),shade(2,{...sample,rain:3},[0,16],1),shade(2,{...sample,snow:1.5},[0,16],1),shade(2,{...sample,snowDepth:.2},[0,16],1)];assert.equal(new Set(colors).size,4);
for(const lat of [0,25,70]){const step=e.windStep(lat,58,sample,1);const a=project([lat,58],5),b=project([step.lat,step.lon],5);assert.ok(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-22.5)<1e-6);assert.ok(b.x>a.x);}
e.kind=0;e.particleTarget=230;e.drawField();for(let i=0;i<120;i++)e.drawParticles(1/60);
assert.ok(e.particles.length>100);assert.ok(e.particles.every(p=>p.trail.length<=14));
const first=e.partCanvas.toBuffer('image/png');writeFileSync('qa-render/wind-a.png',first);for(let i=0;i<30;i++)e.drawParticles(1/60);assert.notDeepEqual(e.partCanvas.toBuffer('image/png'),first);writeFileSync('qa-render/wind-b.png',e.partCanvas.toBuffer('image/png'));
e.setHour(1);assert.equal(e.particles.length,0);
console.log('PASS: rendered cloud/rain/snowfall/snow-cover, transparent dry sky, stable projected wind speeds at 0/25/70 latitude, animated short trails, scrub clears old trails.');
await server.close();
