import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSkyCode } from "./skyCondition.ts";

test("global dry-sky policy retains scattered clouds instead of forcing clear", () => {
  for (const [cover, expected] of [[0, 0], [9.9, 0], [10, 1], [34.9, 1], [35, 2], [84.9, 2], [85, 3], [100, 3]]) {
    assert.equal(reconcileSkyCode(0, cover), expected);
  }
  assert.equal(reconcileSkyCode(2, 0), 2);
  assert.equal(reconcileSkyCode(3, 20), 3);
});
test("cloud evidence never creates or erases precipitation, fog, snow or storms", () => {
  for (const code of [45, 48, 51, 56, 61, 63, 65, 67, 71, 73, 77, 80, 82, 85, 86, 95, 96, 99]) {
    for (const cover of [0, 15, 50, 100]) assert.equal(reconcileSkyCode(code, cover), code);
  }
});
test("missing, invalid or out-of-range cover cannot fabricate a correction", () => {
  for (const cover of [undefined, null, "80", NaN, Infinity, -1, 101]) {
    for (const code of [0, 1, 2, 3]) assert.equal(reconcileSkyCode(code, cover), code);
  }
});
