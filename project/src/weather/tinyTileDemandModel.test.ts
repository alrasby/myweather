import assert from "node:assert/strict";
import { test } from "node:test";
import { TinyTileDemandModel, TILE_ACTIONS } from "./tinyTileDemandModel.ts";

const s = {movingX:1,movingY:0,playing:false,slowNetwork:false};
test("tiny neural softmax begins disabled and learns an observable demand direction",()=>{
 const model = new TinyTileDemandModel();
 assert.equal(model.predict(s),null);
 assert.equal(model.maxWeights,30);
 for(let i=0;i<100;i++)model.observe(s,"east");
 assert.equal(model.predict(s),"east");
 assert.ok((model.accuracy??0)>0.7);
 assert.equal(model.observations,100);
 model.reset();
 assert.equal(model.predict(s),null);
 assert.equal(model.observations,0);
});
test("invalid, missing and contradictory observations cannot inject weather or hang the predictor",()=>{
 const model=new TinyTileDemandModel();
 model.observe({...s,movingX:Number.NaN},"east");
 model.observe(s,"fabricated" as never);
 assert.equal(model.observations,0);
 for(let i=0;i<2500;i++)model.observe({...s,playing:i%2===0},TILE_ACTIONS[i%TILE_ACTIONS.length]!);
 assert.ok(model.observations<=2048);
 assert.ok(model.predict(s)===null||TILE_ACTIONS.includes(model.predict(s)!));
});
