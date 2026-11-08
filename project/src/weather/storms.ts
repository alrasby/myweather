import { fetchStormPack, type StormCollection } from "@/weather/storms.functions";

export type StormPack = { cone: StormCollection; future: StormCollection; past: StormCollection };

const empty = (): StormCollection => ({ type: "FeatureCollection", features: [] });

let cache: StormPack | null = null;
let pending: Promise<StormPack | null> | null = null;

function parsePack(raw: string): StormPack {
  try {
    const json = JSON.parse(raw) as Partial<StormPack>;
    return {
      cone: json.cone?.type === "FeatureCollection" ? json.cone : empty(),
      future: json.future?.type === "FeatureCollection" ? json.future : empty(),
      past: json.past?.type === "FeatureCollection" ? json.past : empty(),
    };
  } catch {
    return { cone: empty(), future: empty(), past: empty() };
  }
}

async function fetchDirect(): Promise<StormPack> {
  const query = async (layer: number): Promise<StormCollection> => {
    const url =
      "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/" +
      `${layer}/query?where=1%3D1&outFields=stormname,stormtype,advisnum&returnGeometry=true&outSR=4326&f=geojson`;
    const res = await fetch(url);
    if (!res.ok) return empty();
    const json = (await res.json()) as StormCollection;
    if (!json || json.type !== "FeatureCollection" || !Array.isArray(json.features)) return empty();
    return json;
  };
  const [cone, future, past] = await Promise.all([query(7), query(6), query(11)]);
  return { cone, future, past };
}

export function loadStormsOnce(): Promise<StormPack | null> {
  if (cache) return Promise.resolve(cache);
  if (!pending) {
    pending = fetchStormPack()
      .then((raw) => parsePack(raw))
      .catch(() => fetchDirect())
      .then((pack) => {
        cache = pack;
        return pack;
      })
      .catch(() => null)
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
