import { createServerFn } from "@tanstack/react-start";

export type StormCollection = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: string; coordinates: unknown } | null;
    properties: Record<string, unknown> | null;
  }[];
};

const empty = (): StormCollection => ({ type: "FeatureCollection", features: [] });

async function queryLayer(layer: number): Promise<StormCollection> {
  const url =
    "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/" +
    `${layer}/query?where=1%3D1&outFields=stormname,stormtype,advisnum&returnGeometry=true&outSR=4326&f=geojson`;
  const res = await fetch(url, {
    headers: { Accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return empty();
  const json = (await res.json()) as StormCollection;
  if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) return empty();
  return json;
}

/** مرة لكل تفعيل: مخروط التوقّع، المسار المستقبلي، المسار السابق — نص JSON حتى يبقى قابلًا للتسلسل. */
export const fetchStormPack = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const [cone, future, past] = await Promise.all([queryLayer(7), queryLayer(6), queryLayer(11)]);
    return JSON.stringify({ cone, future, past });
  } catch {
    return JSON.stringify({ cone: empty(), future: empty(), past: empty() });
  }
});
