import { Capacitor } from "@capacitor/core";
import { proxyFetch } from "@/weather/net";
import { fetchCycloneTexts } from "@/weather/cyclone.functions";
import { proxyWeather } from "@/weather/proxy.functions";

/** إعصار حي من NHC أو GDACS، مع منشأ المسار واتجاه الحركة وسرعتها. */
export type LiveCyclone = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  windKmh: number;
  moveDir: number;
  moveKmh: number;
  track: { lat: number; lon: number }[];
};

const KT = 1.852;

export type CycloneLoad = { storms: LiveCyclone[]; ok: boolean };

let cache: LiveCyclone[] | null = null;
let pending: Promise<CycloneLoad> | null = null;

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function hav(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingTo(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function cleanName(raw: string): string {
  const cut = raw.replace(/^tropical cyclone\s+/i, "").replace(/^hurricane\s+/i, "").replace(/^typhoon\s+/i, "");
  const token = cut.split(/[\s-]/).find((p) => /[A-Za-z\u0600-\u06FF]{3,}/.test(p));
  return (token ?? cut).slice(0, 16).toUpperCase();
}

function usableBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const trimmed = body.trim();
  if (trimmed.length < 24) return null;
  if (/request rejected|access denied|^<!doctype|^<html/i.test(trimmed)) return null;
  return trimmed;
}

const READ_MS = 8000;

async function readText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), READ_MS);
  const pull = async (): Promise<string | null> => {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json, application/xml, text/plain, */*" },
    });
    if (!res.ok) return null;
    return usableBody(await res.text());
  };
  try {
    if (Capacitor.isNativePlatform()) {
      const direct = await pull().catch(() => null);
      if (direct) return direct;
    }
    const res = await proxyFetch(url, ctrl.signal);
    if (!res.ok) return null;
    return usableBody(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fromNhc(json: unknown): LiveCyclone[] {
  const list = (json as { activeStorms?: unknown[] } | null)?.activeStorms;
  if (!Array.isArray(list)) return [];
  const out: LiveCyclone[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const lat = num(s.latitudeNumeric);
    const lon = num(s.longitudeNumeric);
    if (lat == null || lon == null) continue;
    const windKt = num(s.intensity) ?? 0;
    const moveKt = num(s.movementSpeed) ?? 0;
    const moveDir = num(s.movementDir) ?? 0;
    const name = cleanName(String(s.name ?? "TC"));
    out.push({
      id: String(s.id ?? name),
      name,
      lat,
      lon,
      windKmh: windKt * KT,
      moveDir,
      moveKmh: moveKt * KT,
      track: [{ lat, lon }],
    });
  }
  return out;
}

type GeoFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
};

function fromGdacsList(json: unknown): GeoFeature[] {
  const features = (json as { features?: GeoFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const now = Date.now();
  const live: GeoFeature[] = [];
  for (const feature of features) {
    const p = feature.properties ?? {};
    const end = Date.parse(String(p.todate ?? ""));
    const current = String(p.iscurrent) === "true" || (Number.isFinite(end) && end > now - 18 * 3_600_000);
    if (!current) continue;
    live.push(feature);
  }
  return live.slice(0, 8);
}

function parseJson(text: string | null): unknown | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("<")) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function coord(value: string, hemi: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return hemi === "S" || hemi === "W" ? -n : n;
}

function issuedMs(text: string): number | null {
  const head = /PGTW\s+(\d{2})(\d{2})(\d{2})/.exec(text);
  if (!head) return null;
  const day = Number(head[1]);
  const hour = Number(head[2]);
  const minute = Number(head[3]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const now = new Date();
  const build = (year: number, month: number) => {
    const t = Date.UTC(year, month, day, hour, minute);
    const d = new Date(t);
    const monthN = ((month % 12) + 12) % 12;
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== monthN || d.getUTCDate() !== day) return null;
    return t;
  };
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  let t = build(year, month);
  if (t == null || t > Date.now() + 3 * 3_600_000) {
    const prev = new Date(Date.UTC(year, month - 1, 1));
    t = build(prev.getUTCFullYear(), prev.getUTCMonth());
  }
  return t;
}

function liveStorm(text: string | null): LiveCyclone | null {
  if (!text) return null;
  const issued = issuedMs(text);
  if (issued != null && (Date.now() - issued > 36 * 3_600_000 || issued > Date.now() + 6 * 3_600_000)) return null;
  return parseJtwcWarning(text);
}

/** تحذير JTWC النصّي: الموقع الحالي، الريح، الحركة، ونقاط التوقّع. */
export function parseJtwcWarning(text: string): LiveCyclone | null {
  const nameM = /SUBJ\/[^\n(]*\(([^)]+)\)/i.exec(text);
  const posM = /REPEAT POSIT:\s*(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])/i.exec(text);
  if (!posM) return null;
  const lat = coord(posM[1]!, posM[2]!);
  const lon = coord(posM[3]!, posM[4]!);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const windM = /MAX SUSTAINED WINDS\s*-\s*(\d+)\s+KT/i.exec(text);
  const moveM = /MOVEMENT PAST SIX HOURS\s*-\s*(\d+)\s+DEGREES AT\s*(\d+)\s+KTS/i.exec(text);
  const track = [{ lat, lon }];
  const fc = /(\d{4,6}Z)\s+---\s+(?:NEAR\s+)?(\d+(?:\.\d+)?)([NS])\s+(\d+(?:\.\d+)?)([EW])/gi;
  let m: RegExpExecArray | null;
  while ((m = fc.exec(text))) {
    const flat = coord(m[2]!, m[3]!);
    const flon = coord(m[4]!, m[5]!);
    if (!Number.isFinite(flat) || !Number.isFinite(flon)) continue;
    const prev = track[track.length - 1]!;
    if (hav(prev, { lat: flat, lon: flon }) < 20) continue;
    track.push({ lat: flat, lon: flon });
  }
  const name = cleanName(nameM?.[1] ?? "TC");
  const windKt = windM ? Number(windM[1]) : 0;
  const moveKt = moveM ? Number(moveM[2]) : 0;
  return {
    id: `jtwc:${name}`,
    name,
    lat,
    lon,
    windKmh: windKt * KT,
    moveDir: moveM ? Number(moveM[1]) : 0,
    moveKmh: Math.max(0, Math.min(80, moveKt * KT)),
    track,
  };
}

async function fromJtwc(): Promise<LiveCyclone[] | null> {
  const xml = await readText("https://www.metoc.navy.mil/jtwc/rss/jtwc.rss");
  if (!xml || !/<(rss|item)\b/i.test(xml)) return null;
  const urls = [
    ...new Set(
      [...xml.matchAll(/https:\/\/www\.metoc\.navy\.mil\/jtwc\/products\/[a-z]{2}\d{4}web\.txt/gi)].map((m) => m[0]),
    ),
  ];
  const texts = await Promise.all(urls.map((url) => readText(url)));
  const out: LiveCyclone[] = [];
  for (const text of texts) {
    const storm = liveStorm(text);
    if (storm) out.push(storm);
  }
  return out;
}

const NOAA_DIR = "https://tgftp.nws.noaa.gov/data/raw/wt/";
const NOAA_INDEX = `${NOAA_DIR}?C=M;O=D`;
const NOAA_PROBES = [
  "wtpn31.pgtw..txt",
  "wtpn32.pgtw..txt",
  "wtio31.pgtw..txt",
  "wtio32.pgtw..txt",
  "wtps31.pgtw..txt",
  "wtps32.pgtw..txt",
  "wtxs31.pgtw..txt",
  "wtxs32.pgtw..txt",
];

function noaaStamp(raw: string): number {
  const t = Date.parse(raw.replace(/-/g, " "));
  return Number.isFinite(t) ? t : NaN;
}

async function fetchNoaaIndex(signal: AbortSignal): Promise<string> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await fetch(NOAA_INDEX, { signal, headers: { Accept: "text/html, */*" } });
      if (!res.ok) return "";
      return await res.text();
    }
    const result = await proxyWeather({ data: { url: NOAA_INDEX } });
    if ((result?.status ?? 0) !== 200 || !result?.body) return "";
    return result.body;
  } catch {
    return "";
  }
}

function indexWarningUrls(html: string): string[] {
  if (!html || /request rejected|access denied/i.test(html.slice(0, 400)) || !/wtpn\d{2}\.pgtw/i.test(html)) return [];
  const now = Date.now();
  const hits: { url: string; at: number }[] = [];
  const row = /href="(wt(?:pn|io|ps|xs)\d{2}\.pgtw\.\.txt)"[\s\S]{0,180}?(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})/gi;
  let m: RegExpExecArray | null;
  while ((m = row.exec(html))) {
    const code = Number(m[1]!.slice(4, 6));
    if (code < 20 || code > 39) continue;
    const at = noaaStamp(m[2]!);
    if (!Number.isFinite(at) || now - at > 36 * 3_600_000 || at > now + 6 * 3_600_000) continue;
    hits.push({ url: NOAA_DIR + m[1], at });
  }
  hits.sort((a, b) => b.at - a.at);
  return hits.map((hit) => hit.url);
}

function stormsFromTexts(texts: Array<string | null>): LiveCyclone[] {
  const out: LiveCyclone[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const storm = liveStorm(text);
    if (!storm || seen.has(storm.id)) continue;
    seen.add(storm.id);
    out.push(storm);
  }
  return out;
}

/** نسخ NOAA لتحذيرات JTWC. ملفات النص تصل حيث يُحجب الفهرس أو موقع البحرية. */
async function fromNoaaRaw(): Promise<LiveCyclone[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), READ_MS);
  try {
    const indexP = fetchNoaaIndex(ctrl.signal);
    const probed = await Promise.all(NOAA_PROBES.map((name) => readText(NOAA_DIR + name)));
    const texts = probed.filter((text): text is string => !!text);
    const ready = stormsFromTexts(texts);
    if (ready.length) return ready;
    const html = await Promise.race([
      indexP,
      new Promise<string>((resolve) => setTimeout(() => resolve(""), texts.length ? 500 : READ_MS)),
    ]);
    const extraUrls = indexWarningUrls(html).filter((url) => !NOAA_PROBES.some((name) => url.endsWith(name)));
    if (extraUrls.length) {
      const extra = await Promise.all(extraUrls.slice(0, 4).map((url) => readText(url)));
      for (const text of extra) if (text) texts.push(text);
    }
    if (!texts.length) return null;
    return stormsFromTexts(texts);
  } finally {
    clearTimeout(timer);
  }
}

function pointOf(feature: GeoFeature): { lat: number; lon: number } | null {
  const p = feature.properties ?? {};
  const coords = feature.geometry?.type === "Point" && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : null;
  const lon = coords ? Number(coords[0]) : num(p.longitude) ?? num(p.lon);
  const lat = coords ? Number(coords[1]) : num(p.latitude) ?? num(p.lat);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function fromGdacs(json: unknown): LiveCyclone[] {
  const live = fromGdacsList(json);
  const out: LiveCyclone[] = [];
  for (const feature of live) {
    const p = feature.properties ?? {};
    const here = pointOf(feature);
    if (!here) continue;
    const wind = num((p.severitydata as { severity?: unknown } | undefined)?.severity) ?? 0;
    out.push({
      id: `gdacs:${String(p.eventid ?? p.eventname ?? out.length)}`,
      name: cleanName(String(p.eventname ?? p.name ?? "TC")),
      lat: here.lat,
      lon: here.lon,
      windKmh: wind,
      moveDir: 0,
      moveKmh: 0,
      track: [{ lat: here.lat, lon: here.lon }],
    });
  }
  return out;
}

function dedupe(list: LiveCyclone[]): LiveCyclone[] {
  const kept: LiveCyclone[] = [];
  for (const storm of list) {
    const i = kept.findIndex((s) => hav(s, storm) < 450);
    if (i < 0) {
      kept.push(storm);
      continue;
    }
    const hit = kept[i]!;
    if (storm.track.length > hit.track.length || (storm.windKmh > hit.windKmh + 20 && storm.track.length >= hit.track.length)) {
      kept[i] = storm;
    }
  }
  return kept;
}

export function loadLiveCyclones(): Promise<CycloneLoad> {
  if (cache?.length) return Promise.resolve({ storms: cache, ok: true });
  if (!pending) {
    pending = gatherCyclones()
      .then((loaded) => {
        if (loaded.storms.length) cache = loaded.storms;
        return loaded;
      })
      .catch(() => ({ storms: [] as LiveCyclone[], ok: false }))
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

async function gatherCyclones(): Promise<CycloneLoad> {
  const native = Capacitor.isNativePlatform();
  const jobs: Promise<{ storms: LiveCyclone[]; world: boolean } | null>[] = [
    (native ? Promise.resolve(null as string[] | null) : fetchCycloneTexts().catch(() => null as string[] | null)).then((texts) => {
      if (!texts) return null;
      const storms = texts.map((text) => liveStorm(text)).filter((storm): storm is LiveCyclone => !!storm);
      return { storms, world: storms.length > 0 };
    }),
    fromJtwc().then((storms) => (storms == null ? null : { storms, world: true })),
    fromNoaaRaw().then((storms) => (storms == null ? null : { storms, world: true })),
    readText("https://www.nhc.noaa.gov/CurrentStorms.json").then((text) => {
      const json = parseJson(text);
      if (!json) return null;
      const storms = fromNhc(json);
      return { storms, world: storms.length > 0 };
    }),
    readText("https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC").then((text) => {
      const json = parseJson(text);
      if (!json) return null;
      return { storms: fromGdacs(json), world: true };
    }),
  ];
  return new Promise((resolve) => {
    let left = jobs.length;
    let world = false;
    const bag: LiveCyclone[] = [];
    let done = false;
    const finish = (part: { storms: LiveCyclone[]; world: boolean } | null) => {
      if (done) return;
      if (part?.world) world = true;
      if (part?.storms.length) bag.push(...part.storms);
      left -= 1;
      if (bag.length) {
        done = true;
        resolve({ storms: dedupe(bag), ok: true });
        return;
      }
      if (left <= 0) resolve({ storms: [], ok: world });
    };
    for (const job of jobs) job.then(finish, () => finish(null));
  });
}
