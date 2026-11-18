import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { lookupPlace } from "./placeLookup.ts";

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
  await setImmediate();
  t.mock.timers.tick(8000);
  assert.equal((await pending)?.name, "الخوض");
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
