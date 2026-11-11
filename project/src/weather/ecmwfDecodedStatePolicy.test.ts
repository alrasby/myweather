import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ECMWF_FIELDS_PER_HOUR, ECMWF_RETAINED_HOURS, ECMWF_DECODED_STATE_LIMIT,
  nextEcmwfFrameToPrepare,
} from "./ecmwfDecodedStatePolicy.ts";

test("decoded OM state budget retains all three model fields across two adjacent hours", () => {
  assert.equal(ECMWF_FIELDS_PER_HOUR, 3);
  assert.equal(ECMWF_RETAINED_HOURS, 2);
  assert.equal(ECMWF_DECODED_STATE_LIMIT, 6);
});

test("next adjacent hour is prepared, but a third speculative hour is not decoded", () => {
  assert.equal(nextEcmwfFrameToPrepare(8, 32, new Set()), 8);
  assert.equal(nextEcmwfFrameToPrepare(8, 32, new Set([8])), 9);
  assert.equal(nextEcmwfFrameToPrepare(8, 32, new Set([8, 9])), null);
  assert.equal(nextEcmwfFrameToPrepare(31, 32, new Set([31])), null);
});
