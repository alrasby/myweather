import assert from "node:assert/strict";
import {test} from "node:test";
import {spatialZoomNeedsNewCoverage} from "./spatialZoomCoverage.ts";

test("a different Leaflet zoom requires newly delivered coherent tiles",()=>{
 assert.equal(spatialZoomNeedsNewCoverage(7,6),true);
 assert.equal(spatialZoomNeedsNewCoverage(6,3),true);
 assert.equal(spatialZoomNeedsNewCoverage(4,8),true);
 assert.equal(spatialZoomNeedsNewCoverage(3,3),false);
});
test("a small pan is not a zoom and must retain previously painted weather",()=>{
 assert.equal(spatialZoomNeedsNewCoverage(5,5.001),false);
 assert.equal(spatialZoomNeedsNewCoverage(null,5),false);
 assert.equal(spatialZoomNeedsNewCoverage(NaN,5),false);
 assert.equal(spatialZoomNeedsNewCoverage(5,Infinity),false);
});
