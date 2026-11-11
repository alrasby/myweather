import assert from "node:assert/strict";
import { test } from "node:test";
import { preserveCoastalMarine, shouldDisplayTideCard } from "./coastalMarine.ts";

test("known coastal city remains coastal when marine service fails or MET.no is used", () => {
  assert.deepEqual(preserveCoastalMarine(null, { coastal: true, wave: 0.9 }), { coastal: true, wave: null });
  assert.deepEqual(preserveCoastalMarine({ coastal: false, wave: null }, { coastal: true, wave: 0.9 }), { coastal: true, wave: 0.9 });
  assert.equal(shouldDisplayTideCard({ coastal: true, wave: null }), true);
});
test("fresh marine measurements win and inland areas are not marked coastal", () => {
  assert.deepEqual(preserveCoastalMarine({ coastal: true, wave: 0.4 }, { coastal: true, wave: 0.9 }), { coastal: true, wave: 0.4 });
  assert.equal(shouldDisplayTideCard({ coastal: false, wave: null }), false);
  assert.equal(shouldDisplayTideCard(null), false);
});
