import {test} from "node:test";
import assert from "node:assert/strict";
import {trackUnstoppableRequest} from "./nativeRequestLifetime.ts";
test("cancelling a JS waiter never releases a still-active native request",async()=>{
 let releaseCount=0, finish!:(n:number)=>void;
 const native=new Promise<number>(resolve=>{finish=resolve});
 const task=trackUnstoppableRequest(native,()=>releaseCount++);
 const cancelled=Promise.race([task,Promise.reject(new Error("user-aborted"))]);
 await assert.rejects(cancelled,/user-aborted/);
 assert.equal(releaseCount,0);
 finish(200);
 assert.equal(await task,200);
 await Promise.resolve();
 assert.equal(releaseCount,1);
});
test("native rejection also releases exactly one permit",async()=>{
 let releases=0, fail!:(e:Error)=>void;
 const native=new Promise<number>((_resolve,reject)=>{fail=reject});
 const work=trackUnstoppableRequest(native,()=>releases++);
 fail(new Error("offline"));
 await assert.rejects(work,/offline/);
 await Promise.resolve();
 assert.equal(releases,1);
});
