import test from "node:test";
import assert from "node:assert/strict";
import { heroRainStreaks } from "./heroRainStreaks.ts";

test("real rain draws modestly denser than former sparse strokes, bounded on all devices", () => {
 const rain=heroRainStreaks(61,.78,12);
 assert.ok(rain.length>=40 && rain.length<=64);
 const storm=heroRainStreaks(95,1,150);
 assert.ok(storm.length>rain.length && storm.length<=64);
 assert.ok(heroRainStreaks(51,.6,3).length<rain.length);
});
test("streaks are deterministic, finite, varying in depth, velocity and opacity", () => {
 const a=heroRainStreaks(61,.85,22), b=heroRainStreaks(61,.85,22);
 assert.deepEqual(a,b);
 assert.deepEqual(new Set(a.map(p=>p.depth)),new Set([0,1,2]));
 assert.ok(new Set(a.map(p=>p.speed)).size>15);
 assert.ok(new Set(a.map(p=>p.opacity)).size>15);
 for(const p of a) {
   assert.ok([p.x,p.y,p.length,p.width,p.opacity,p.speed,p.drift].every(Number.isFinite));
   assert.ok(p.opacity>0 && p.opacity<0.8 && p.width<=1.3 && p.length<=15);
 }
});
test("untrusted wind/cloud values cannot explode particle counts or drift", () => {
 for(const n of [-Infinity,Infinity,NaN,-100,10000]){
  const drops=heroRainStreaks(82,n,n);
  assert.ok(drops.length<=64);
  assert.ok(drops.every(d=>Number.isFinite(d.drift) && d.drift<35));
 }
});
