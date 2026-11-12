import assert from "node:assert/strict";
import { test } from "node:test";
import { validatedWeatherProxyUrl } from "./proxySecurity.ts";

test("allows canonical HTTPS upstream weather providers", () => {
  assert.equal(validatedWeatherProxyUrl("https://api.open-meteo.com/v1/forecast?latitude=23.5"),
    "https://api.open-meteo.com/v1/forecast?latitude=23.5");
  assert.ok(validatedWeatherProxyUrl("https://api.met.no/weatherapi/locationforecast/2.0/compact").includes("api.met.no"));
});
test("rejects SSRF via private networks, credentials, mixed schemes and redirector names", () => {
  for (const value of [
    "http://api.open-meteo.com/v1/forecast", "https://127.0.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://api.open-meteo.com.evil.example/v1/forecast",
    "https://user:pass@api.open-meteo.com/v1/forecast",
    "file:///etc/passwd",
    "https://api.open-meteo.com:8443/v1/forecast",
    "https://api.open-meteo.com/v1/forecast#fragment",
    "https://api.open-meteo.com/" + "x".repeat(3200),
  ]) assert.throws(() => validatedWeatherProxyUrl(value), value);
});
