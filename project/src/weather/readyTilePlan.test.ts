import assert from 'node:assert/strict';
import {test} from 'node:test';
import {planReadyTilePrefetch} from './readyTilePlan.ts';
const base={z:4,x:15,y:4,hour:2,count:10,movingX:1,movingY:0,playing:true,dataSaver:false};
test('bounded predictive prefetch honors next real hour and dateline',()=>{
 const a=planReadyTilePrefetch(base);
 assert.ok(a.length>0&&a.length<=8&&a.every(p=>p.hour===3&&p.x>=0&&p.x<16));
 assert.ok(a.some(p=>p.x===0));assert.equal(new Set(a.map(p=>p.hour+'/'+p.layer+'/'+p.x+'/'+p.y)).size,a.length);
});
test('data saver and invalid bounds cancel speculative work',()=>{
 assert.deepEqual(planReadyTilePrefetch({...base,dataSaver:true}),[]);
 assert.deepEqual(planReadyTilePrefetch({...base,z:18}),[]);
 assert.ok(planReadyTilePrefetch({...base,playing:false}).every(p=>p.hour===2));
 assert.ok(planReadyTilePrefetch({...base,hour:9}).every(p=>p.hour===9));
});
