import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedWeatherResponse, validateWeatherProxyUrl } from "./proxyPolicy.ts";

test("weather proxy accepts only HTTPS allowlisted data hosts", () => {
  const url = validateWeatherProxyUrl("https://api.open-meteo.com/v1/forecast?latitude=23.6&longitude=58.5");
  assert.equal(new URL(url).hostname, "api.open-meteo.com");
  for (const bad of [
    "http://api.open-meteo.com/v1/forecast",
    "https://127.0.0.1/",
    "https://api.open-meteo.com.attacker.example/",
    "https://user:pass@api.open-meteo.com/",
    "https://api.open-meteo.com:444/",
    "file:///etc/passwd",
  ]) assert.throws(() => validateWeatherProxyUrl(bad), /host|url/, bad);
});

test("stream reader limits decompressed bytes, not only Content-Length", async () => {
  const tooLarge = new Response("0123456789");
  await assert.rejects(readBoundedWeatherResponse(tooLarge, 5), /too-large/);
  assert.equal(await readBoundedWeatherResponse(new Response("weather data"), 100), "weather data");
});
