import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { StormCollection } from '../weather/storms.functions';

// Android ships static assets and talks directly to the public data providers.
export async function proxyWeather({ data }: { data: { url: string } }) {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({ url: data.url, responseType: 'text', connectTimeout: 20000, readTimeout: 20000 });
    return { status: res.status, body: typeof res.data === 'string' ? res.data : JSON.stringify(res.data) };
  }
  const res = await fetch(data.url, { signal: AbortSignal.timeout(20000) });
  return { status: res.status, body: await res.text() };
}

export async function fetchCycloneTexts(): Promise<string[]> {
  const rss = await proxyWeather({ data: { url: 'https://www.metoc.navy.mil/jtwc/rss/jtwc.rss' } });
  if (rss.status !== 200) return [];
  const urls = [...new Set([...rss.body.matchAll(/https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/[a-z]{2}\d{4}web\.txt/gi)].map(m => m[0]))];
  return (await Promise.all(urls.map(async url => (await proxyWeather({ data: { url } })).body))).filter(t => t.includes('REPEAT POSIT'));
}

export async function fetchStormPack(): Promise<string> {
  const query = async (layer: number): Promise<StormCollection> => {
    const url = `https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather_summary/MapServer/${layer}/query?where=1%3D1&outFields=stormname,stormtype,advisnum&returnGeometry=true&outSR=4326&f=geojson`;
    const res = await proxyWeather({ data: { url } });
    if (res.status !== 200) throw new Error('Storm data unavailable');
    const data = JSON.parse(res.body);
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid storm data');
    return data;
  };
  const [cone, future, past] = await Promise.all([query(7), query(6), query(11)]);
  return JSON.stringify({ cone, future, past });
}
