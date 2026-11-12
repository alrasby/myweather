import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectMapTilerCatalog, parseMapTilerCatalog } from "./maptilerPilot.ts";

test("MapTiler pilot parses only real dated catalog variables and never invents tiles", () => {
  const catalog = parseMapTilerCatalog({ variables: [
    { metadata: { weather_variable: { variable_id: "precipitation:gfs", unit: "mm" } },
      keyframes: [{ timestamp: "2026-11-12T12:00:00Z" }, { timestamp: "2026-11-12T06:00:00Z" }] },
    { metadata: { weather_variable: { variable_id: "bad /path" } }, keyframes: [{ timestamp: "oops" }] },
  ] });
  assert.deepEqual(catalog.variables, [{
    id: "precipitation:gfs", unit: "mm", keyframeCount: 2,
    firstTime: "2026-11-12T06:00:00Z", lastTime: "2026-11-12T12:00:00Z",
  }]);
  assert.equal("tileUrl" in catalog.variables[0]!, false);
});

test("no MapTiler HTTP request without an explicit valid public key", async () => {
  let calls = 0;
  const request = (async () => { calls++; throw new Error("must not call"); }) as typeof fetch;
  await assert.rejects(inspectMapTilerCatalog("", undefined, request), /missing-or-invalid/);
  await assert.rejects(inspectMapTilerCatalog("key&extra", undefined, request), /missing-or-invalid/);
  assert.equal(calls, 0);
});

test("MapTiler pilot fetches catalog only on request and never returns the key", async () => {
  const key = "restricted-test-key";
  let url = "";
  const request = (async (input: RequestInfo | URL) => {
    url = String(input);
    return new Response(JSON.stringify({ variables: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const catalog = await inspectMapTilerCatalog(key, undefined, request);
  assert.equal(new URL(url).pathname, "/weather/latest.json");
  assert.equal(new URL(url).searchParams.get("key"), key);
  assert.deepEqual(catalog, { variables: [] });
  assert.equal(JSON.stringify(catalog).includes(key), false);
});

test("MapTiler pilot never presents a failed provider response as valid weather data", async () => {
  const request = (async () => new Response("unauthorized", { status: 403 })) as typeof fetch;
  await assert.rejects(inspectMapTilerCatalog("restricted-key", undefined, request), /maptiler-http-403/);
});
