import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { lookupPlace, cachedPlaceName, hasPlaceName } from "./placeLookup.ts";

const response = (name: string) => new Response(JSON.stringify({ address: { city: name, country: "Oman" } }));

test("a name arriving after the old 2.8-second deadline is retained", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => setTimeout(() => resolve(response("قريات")), 3100)));
  const pending = lookupPlace(23.192, 58.877);
  t.mock.timers.tick(3100);
  assert.equal((await pending)?.name, "قريات");
});

test("an unresponsive provider cannot discard the other provider's successful name", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", (url: URL) => url.hostname.includes("nominatim")
    ? new Promise<Response>(() => {})
    : Promise.resolve(new Response(JSON.stringify({ locality: "الخوض", countryName: "Oman" }))));
  const pending = lookupPlace(23.6, 58.1);
  const immediate = await Promise.race([pending, setImmediate().then(() => null)]);
  assert.equal(immediate?.name, "الخوض", "healthy provider must not wait for the 8-second deadline");
});

test("same-point concurrent lookups share requests and successful names survive network loss", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response("مسقط"));
  const [a, b] = await Promise.all([lookupPlace(23.588, 58.383), lookupPlace(23.588, 58.383)]);
  assert.equal(a?.name, "مسقط");
  assert.equal(b?.name, "مسقط");
  assert.equal(fetch.mock.callCount(), 2);
  fetch.mock.mockImplementation(async () => { throw Error("offline"); });
  assert.equal((await lookupPlace(23.588, 58.383))?.name, "مسقط");
  assert.equal(fetch.mock.callCount(), 2);
});

test("failed lookups can recover and invalid coordinates never start network work", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw Error("offline"); });
  assert.equal(await lookupPlace(23.2, 58.9), null);
  fetch.mock.mockImplementation(async () => response("Recovered"));
  assert.equal((await lookupPlace(23.2, 58.9))?.name, "Recovered");
  const count = fetch.mock.callCount();
  assert.equal(await lookupPlace(Number.NaN, 58), null);
  assert.equal(fetch.mock.callCount(), count);
});


test("nearby GPS jitter reuses a known name while distant fixes do not borrow it", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response("Known neighborhood"));
  await lookupPlace(32.1, -110.9);
  assert.equal((await lookupPlace(32.1005, -110.9005))?.name, "Known neighborhood");
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(cachedPlaceName(33.1, -110.9), null);
  assert.equal(hasPlaceName("موقعي"), false);
  assert.equal(hasPlaceName("My location"), false);
  assert.equal(hasPlaceName("٢٣.١٩٢، ٥٨.٨٧٧"), false);
});

test("successful nearby names survive module restart without a network connection", () => {
  const moduleUrl = new URL("./placeLookup.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    let stored = null;
    globalThis.localStorage = {getItem:()=>stored, setItem:(_,value)=>{stored=value;}};
    globalThis.fetch = async()=>new Response(JSON.stringify({address:{city:'Persistent name',country:'Oman'}}));
    const first=await import(${JSON.stringify(moduleUrl)});
    assert.equal((await first.lookupPlace(23.55,58.45)).name,'Persistent name');
    assert.ok(stored);
    globalThis.fetch=async()=>{throw Error('offline');};
    const restarted=await import(${JSON.stringify(moduleUrl)}+'?restart');
    assert.equal((await restarted.lookupPlace(23.5503,58.4503)).name,'Persistent name');
    assert.equal(restarted.cachedPlaceName(24.5,58.45),null);
  `], { encoding: "utf8", timeout: 5000 });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test("stalled naming providers stop at the deadline and generic labels are never accepted", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise<Response>(() => {}));
  const pending = lookupPlace(40.1, 70.2);
  t.mock.timers.tick(8000);
  assert.equal(await pending, null);
  fetch.mock.mockImplementation(async () => response("موقعي"));
  assert.equal(await lookupPlace(40.1, 70.2), null);
  assert.equal(cachedPlaceName(40.1, 70.2), null);
});
