import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:new URL('../',import.meta.url).pathname,configFile:new URL('../vite.android.config.ts',import.meta.url).pathname,server:{middlewareMode:true}});
const {FieldEngine}=await server.ssrLoadModule('/src/weather/glField.ts');
const {estimateGrid}=await server.ssrLoadModule('/src/weather/estimate.ts');
const canvas=()=>({style:{},getContext:()=>null});
const previousDocument=globalThis.document;
globalThis.document={createElement:canvas};
const view={south:0,north:55,west:20,east:100};
const make=(id)=>({...estimateGrid({south:-80,north:84,west:-180,lonSpan:360,cols:24,rows:12,hours:2,full:true}),id});
const incomplete=g=>{const next={...g,id:g.id+'-partial',ok:g.ok.slice()};for(let h=0;h<g.hours;h++)for(let r=6;r<g.rows;r++)next.ok.fill(0,(h*g.rows+r)*g.cols,(h*g.rows+r+1)*g.cols);return next;};
try{
 for(const kind of [0,1])await test('partial northern coverage cannot replace complete '+(kind===0?'wind':'temperature')+' field',()=>{
  const e=new FieldEngine({});e.setKind(kind);e.frameBox=view;
  const complete=make('source-complete');e.setGlobal(complete);
  e.setGlobal(incomplete(make('source-new')));
  assert.equal(e.pick()?.id,complete.id);
 });
 await test('incomplete regional detail must not blank a complete global field',()=>{
  const e=new FieldEngine({});e.setKind(1);e.frameBox=view;
  const complete=make('world');e.setGlobal(complete);
  e.setDetail(incomplete(make('detail')));
  assert.equal(e.pick()?.id,complete.id);
 });
 await test('a complete update is promoted and source arrays are never modified',()=>{
  const e=new FieldEngine({});e.setKind(0);e.frameBox=view;
  const a=make('a'),b=make('b'),mask=b.ok.slice(),temps=b.temp.slice();
  e.setGlobal(a);e.setGlobal(b);assert.equal(e.pick()?.id,b.id);
  assert.deepEqual(b.ok,mask);assert.deepEqual(b.temp,temps);
 });

 await test('real partial data is used where covered and safe data returns after panning north',()=>{
  const e=new FieldEngine({});e.setKind(1);
  const good=make('good'),partial=incomplete(make('new'));
  e.setGlobal(good);e.setGlobal(partial);
  e.frameBox={south:-70,north:-35,west:170,east:200};
  assert.equal(e.pick()?.id,partial.id);
  e.frameBox=view;assert.equal(e.pick()?.id,good.id);
 });
 await test('a fractional hour cannot interpolate into a missing next-hour field',()=>{
  const e=new FieldEngine({});e.setKind(0);e.frameBox=view;e.hour=0.5;
  const good=make('good'),bad=make('bad');
  bad.ok=bad.ok.slice();bad.ok.fill(0,bad.cols*bad.rows);
  e.setGlobal(good);e.setGlobal(bad);assert.equal(e.pick()?.id,good.id);
 });
}finally{globalThis.document=previousDocument;await server.close();}
