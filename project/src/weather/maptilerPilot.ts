/** MapTiler Weather catalog-only pilot, intentionally NOT a replacement
 * for ECMWF imagery. Opt-in diagnostics, no requests without a user-provided
 * restricted public key, no persistent storage and no invented tile URLs.
 * MapTiler's weather layers use its own SDK; a catalog response alone is
 * not permission to overlay arbitrary PNG imagery on Leaflet.
 */
export type MapTilerPilotVariable = {
  id: string;
  unit: string | null;
  keyframeCount: number;
  firstTime: string | null;
  lastTime: string | null;
};
export type MapTilerPilotCatalog = { variables: MapTilerPilotVariable[] };

export function parseMapTilerCatalog(raw: unknown): MapTilerPilotCatalog {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { variables?: unknown }).variables)) {
    throw new Error("maptiler-catalog-invalid");
  }
  const variables = (raw as { variables: unknown[] }).variables;
  const out: MapTilerPilotVariable[] = [];
  for (const candidate of variables.slice(0, 80)) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Record<string, unknown>;
    const metadata = record.metadata as Record<string, unknown> | undefined;
    const weather = metadata?.weather_variable as Record<string, unknown> | undefined;
    const id = weather?.variable_id;
    if (typeof id !== "string" || !/^[a-z0-9:_-]{1,100}$/i.test(id)) continue;
    const timestamps = Array.isArray(record.keyframes)
      ? record.keyframes.slice(0, 160).map((frame: unknown) =>
        frame && typeof frame === "object" ? (frame as { timestamp?: unknown }).timestamp : null)
        .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
        .sort((a, b) => Date.parse(a) - Date.parse(b))
      : [];
    out.push({
      id,
      unit: typeof weather?.unit === "string" ? weather.unit.slice(0, 30) : null,
      keyframeCount: timestamps.length,
      firstTime: timestamps[0] ?? null,
      lastTime: timestamps.at(-1) ?? null,
    });
  }
  return { variables: out };
}

export async function inspectMapTilerCatalog(
  publicKey: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<MapTilerPilotCatalog> {
  const key = publicKey.trim();
  if (!key || key.length > 256 || /[\s?#&]/.test(key)) {
    throw new Error("maptiler-key-missing-or-invalid");
  }
  const url = new URL("https://api.maptiler.com/weather/latest.json");
  url.searchParams.set("key", key);
  const response = await request(url.toString(), {
    method: "GET", signal, cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    // Never include the API key or full URL in diagnostic messages.
    throw new Error(`maptiler-http-${response.status}`);
  }
  return parseMapTilerCatalog(await response.json());
}
