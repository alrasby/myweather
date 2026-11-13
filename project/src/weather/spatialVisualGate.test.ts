import assert from "node:assert/strict";
import {test} from "node:test";
import {spatialRevealDecision,visualViewportReady} from "./spatialVisualGate.ts";
const v={west:52,east:62,south:19,north:29,zoom:5};
test("small same-zoom pan stages real tiles without showing rectangular partial batches",()=>{
 assert.equal(spatialRevealDecision(true,v,{...v,west:53,east:63}),"stage");
 assert.equal(spatialRevealDecision(true,v,{...v,west:57,east:67}),"hide-incomplete");
 assert.equal(spatialRevealDecision(true,v,{...v,zoom:6}),"hide-incomplete");
 assert.equal(spatialRevealDecision(true,null,v),"hide-incomplete");
 assert.equal(spatialRevealDecision(false,null,v),"initial");
});
test("valid source-backed 3-layer viewport is only published after all three real queues settle",()=>{
 assert.equal(visualViewportReady([true,true,true],[4,4,4],[0,0,0]),true);
 assert.equal(visualViewportReady([true,false,true],[4,0,4],[0,0,0]),false);
 assert.equal(visualViewportReady([true,true,true],[4,4,4],[0,1,0]),false);
 assert.equal(visualViewportReady([true,true,true],[4,0,4],[0,0,0]),false);
});
