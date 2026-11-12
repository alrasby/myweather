import assert from "node:assert/strict";
import { test } from "node:test";
import { providerRetryMs, SpatialRateLimit, SpatialRateLimitError } from "./spatialRateLimit.ts";

test("429 honors Retry-After and prevents immediate duplicate native/browser attempts", () => {
  const throttle = new SpatialRateLimit();
  assert.equal(throttle.observe(429, "15", 1000), 15000);
  assert.equal(throttle.remainingMs(4000), 12000);
  assert.throws(() => throttle.assertAllowed(4000), SpatialRateLimitError);
  throttle.assertAllowed(16000);
  assert.equal(throttle.incidents, 1);
});

test("missing 429 hint uses bounded backoff and repeated 429 never shortens cooldown", () => {
  const throttle = new SpatialRateLimit();
  assert.equal(throttle.observe(429, null, 1000), 30000);
  assert.equal(throttle.observe(429, "1", 2500), 5000);
  assert.equal(throttle.remainingMs(2500), 28500);
});

test("503 only throttles with Retry-After; unrelated responses do not change budget", () => {
  const throttle = new SpatialRateLimit();
  assert.equal(throttle.observe(503, null, 1000), 0);
  assert.equal(throttle.observe(200, "120", 1000), 0);
  assert.equal(throttle.observe(503, "10", 1000), 10000);
  assert.equal(throttle.remainingMs(5000), 6000);
});

test("HTTP-date retry hints and extreme values are bounded without too-short retries", () => {
  const now = Date.parse("2026-11-12T06:00:00Z");
  assert.equal(providerRetryMs(429, new Date(now + 25000).toUTCString(), now), 25000);
  assert.equal(providerRetryMs(429, "9000", now), 3600000);
  assert.equal(providerRetryMs(429, "invalid date", now), 30000);
});

test("user-canceled requests remain independent from provider throttling", () => {
  const limiter = new SpatialRateLimit();
  assert.equal(limiter.remainingMs(), 0);
  assert.equal(limiter.observe(404, null), 0);
  limiter.assertAllowed();
});
