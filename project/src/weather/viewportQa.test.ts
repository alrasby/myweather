import test from "node:test";
import assert from "node:assert/strict";
import { viewportQaSnapshot, type ViewportQaDiagnostics } from "./viewportQa.ts";

const sample = (): ViewportQaDiagnostics => ({
  source: "spatial", frame: 12, requestedFrame: 12, displayedFrame: 12,
  requestedValidTime: "2026-11-15T12:00:00.000Z",
  displayedValidTime: "2026-11-15T12:00:00.000Z",
  visibleOpacity: 1, viewportHeld: false,
  currentTileCoverage: [0, 1, 2].map(() => ({ delivered: 2, required: 2, hidden: 0 })),
  startupMs: { firstCompleteReady: 4500 },
  spatialViewportPolicy: { allow: true, reason: "regional" },
});

test("source-verified full-viewport cloud/rain/snow accepts matching model time", () => {
  const r = viewportQaSnapshot(sample(), 6, { latitude: 15.7, longitude: 7.9 });
  assert.equal(r.status, "complete");
  assert.equal(r.verifiedComplete, true);
  assert.equal(r.mapZoom, 6);
  assert.equal("lat" in r || "lon" in r || "center" in r, false);
});

test("observed zoom-6 0/2 cloud/rain and snow 2/2 is never claimed complete", () => {
  const d = sample();
  d.source = "fallback";
  d.displayedFrame = null;
  d.displayedValidTime = null;
  d.visibleOpacity = 0;
  d.currentTileCoverage = [
    { delivered: 0, required: 2, hidden: 0 },
    { delivered: 0, required: 2, hidden: 0 },
    { delivered: 2, required: 2, hidden: 0 },
  ];
  assert.equal(viewportQaSnapshot(d, 6, { latitude: 15.7, longitude: 7.9 }).verifiedComplete, false);
});

test("previous viewport startup success and visible old-hour raster cannot authorize new zoom", () => {
  const d = sample();
  d.displayedFrame = 13;
  d.displayedValidTime = "2026-11-15T13:00:00.000Z";
  assert.equal(viewportQaSnapshot(d, 3, { latitude: 75, longitude: 120 }).status, "source-visible-pending-coverage");
  d.displayedFrame = 12;
  d.displayedValidTime = "2026-11-15T12:00:00.000Z";
  d.currentTileCoverage![1].delivered = 1;
  assert.equal(viewportQaSnapshot(d, 3, { latitude: 75, longitude: 120 }).verifiedComplete, false);
});

test("held frame, hidden tile and time mismatch all remain incomplete", () => {
  const held = sample(); held.viewportHeld = true;
  assert.equal(viewportQaSnapshot(held, 4, { latitude: 20, longitude: 10 }).verifiedComplete, false);
  const hidden = sample(); hidden.currentTileCoverage![0].hidden = 1;
  assert.equal(viewportQaSnapshot(hidden, 4, { latitude: 20, longitude: 10 }).verifiedComplete, false);
  const wrongTime = sample(); wrongTime.displayedValidTime = "2026-11-15T13:00:00.000Z";
  assert.equal(viewportQaSnapshot(wrongTime, 4, { latitude: 20, longitude: 10 }).verifiedComplete, false);
});

test("missing model and invalid spans are finite and explicitly incomplete", () => {
  const r = viewportQaSnapshot(null, NaN, { latitude: NaN, longitude: Infinity });
  assert.deepEqual(r.viewportSpanDegrees, { latitude: null, longitude: null });
  assert.equal(r.verifiedComplete, false);
  assert.equal(r.mapZoom, null);
});

test("real 2026-11-15 17:59:54 zoom-6 report accepts fully visible 18Z contributor, not transparent 17Z", () => {
  const d=sample();
  d.frame=11; d.requestedFrame=11; d.displayedFrame=12;
  d.requestedValidTime="2026-11-15T17:00:00.000Z";
  d.displayedValidTime="2026-11-15T18:00:00.000Z";
  d.blendFraction=1;
  d.visibleOpacity=0.99999412548;
  d.modelRunPinned=true;
  d.currentTileCoverage=[0,1,2].map(()=>({required:4,delivered:0,hidden:0}));
  d.compositedViewportCoverage=[{
    frame:12,validTime:d.displayedValidTime,opacity:0.99999412548,
    coverage:[0,1,2].map(()=>({required:4,delivered:4,hidden:0})),
  }];
  const r=viewportQaSnapshot(d,6,{latitude:9.6,longitude:7.9});
  assert.equal(r.verifiedComplete,true);
  assert.equal(r.displayedFrame,12);
  assert.deepEqual(r.coverage.map(c=>c.delivered),[4,4,4]);
});

test("genuinely interpolated source hours need complete independent coverage of BOTH rasters", () => {
  const d=sample();
  d.blendFraction=0.4; d.visibleOpacity=1;
  d.compositedViewportCoverage=[
    {frame:12,validTime:d.requestedValidTime!,opacity:0.6,
     coverage:[0,1,2].map(()=>({required:4,delivered:4,hidden:0}))},
    {frame:13,validTime:"2026-11-15T13:00:00.000Z",opacity:0.4,
     coverage:[0,1,2].map(()=>({required:4,delivered:4,hidden:0}))},
  ];
  assert.equal(viewportQaSnapshot(d,6,{latitude:10,longitude:8}).verifiedComplete,true);
  d.compositedViewportCoverage[1]!.coverage[0]!.delivered=1;
  assert.equal(viewportQaSnapshot(d,6,{latitude:10,longitude:8}).verifiedComplete,false);
});

test("missing dominant coverage, early future frame, fake UTC or held raster all block QA", () => {
  const d=sample();
  d.displayedFrame=13; d.displayedValidTime="2026-11-15T13:00:00.000Z";
  d.blendFraction=0.7;
  d.compositedViewportCoverage=[{
    frame:13, validTime:d.displayedValidTime!, opacity:1,
    coverage:[0,1,2].map(()=>({required:4,delivered:4,hidden:0})),
  }];
  const check=()=>viewportQaSnapshot(d,6,{latitude:10,longitude:8}).verifiedComplete;
  assert.equal(check(),false,"future-hour-only cannot masquerade as incomplete interpolation");
  d.blendFraction=1;
  assert.equal(check(),true);
  d.compositedViewportCoverage[0]!.coverage[2]!.hidden=1;
  assert.equal(check(),false);
  d.compositedViewportCoverage[0]!.coverage[2]!.hidden=0;
  d.compositedViewportCoverage[0]!.validTime="2026-11-15T14:00:00.000Z";
  assert.equal(check(),false);
  d.compositedViewportCoverage[0]!.validTime=d.displayedValidTime!;
  d.holdingPreviousFrame=true;
  assert.equal(check(),false);
  d.holdingPreviousFrame=false;
  d.errors=[0,1,0];
  assert.equal(check(),false);
  d.errors=[0,0,0];d.modelRunPinned=false;
  assert.equal(check(),false);
});
