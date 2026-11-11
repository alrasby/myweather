/** أنواع الطقس المشتركة — قابلة للتخزين في localStorage (أرقام فقط، بلا Date). */

export type LangPref = "system" | "ar" | "en";
export type Lang = "ar" | "en";
export type TempUnit = "c" | "f";
export type WindUnit = "kmh" | "ms" | "mph" | "kn";
export type PressureUnit = "hpa" | "inhg";
export type DistanceUnit = "km" | "mi";
export type ParticleDensity = "low" | "med" | "high";
export type ThemeMode = "sun" | "system" | "light" | "dark";
export type RefreshMin = 0 | 15 | 30 | 60 | 180 | 360;
export type QuietHours = "off" | "22-6" | "23-7";
export type MorningAt = "5:30" | "6:00" | "6:30" | "7:30";
export type ShadeKind = 0 | 1 | 2;
export type TabId = "home" | "map" | "settings";

export type Place = {
  id: string;
  name: string;
  nameEn?: string;
  country: string;
  countryEn?: string;
  admin: string;
  lat: number;
  lon: number;
  primary: boolean;
};

export type Prefs = {
  temp: TempUnit;
  wind: WindUnit;
  pressure: PressureUnit;
  distance: DistanceUnit;
  lang: LangPref;
  theme: ThemeMode;
  mapHours: 24 | 48 | 72;
  particles: ParticleDensity;
  dataSaver: boolean;
  storms: boolean;
  /** يُضبط عند لمس مفتاح الأعاصير حتى لا نُعيد فتحه بعد إغلاقه يدويًا. */
  stormsSet?: boolean;
  mapLayer: ShadeKind;
  refreshMin: RefreshMin;
  alerts: boolean;
  wifiOnly: boolean;
  rainAlert: 0.2 | 1 | 2;
  windAlert: 30 | 45 | 60;
  dustAlert: 80 | 150 | 250;
  morning: MorningAt;
  quiet: QuietHours;
};

export type CurrentWeather = {
  t: number;
  temp: number;
  feels: number;
  humidity: number;
  precip: number;
  code: number;
  cloud: number;
  pressure: number;
  wind: number;
  gust: number;
  dir: number;
  visibility: number;
  isDay: boolean;
};

export type HourPoint = {
  t: number;
  temp: number;
  precip: number;
  pop: number;
  code: number;
  wind: number;
  gust: number;
  feels: number;
  uv: number;
  isDay: boolean;
  pressure: number;
};

export type DayPoint = {
  t: number;
  code: number;
  tmax: number;
  tmin: number;
  sunrise: number;
  sunset: number;
  precip: number;
  pop: number;
  uv: number;
  wind: number;
};

export type AirQuality = {
  aqi: number | null;
  pm25: number | null;
  pm10: number | null;
  dust: number | null;
  dustHourly: { t: number; v: number }[];
};

export type MarineSnap = {
  coastal: boolean;
  wave: number | null;
  tides?: { t: number; level: number }[];
};

export type WeatherBundle = {
  placeId: string;
  timezone: string;
  offset: number;
  fetchedAt: number;
  current: CurrentWeather;
  hourly: HourPoint[];
  daily: DayPoint[];
  air: AirQuality | null;
  marine: MarineSnap | null;
};

/** شبكة Open-Meteo: كل مصفوفة بطول hours*rows*cols، الصف 0 = الجنوب. */
export type GridField = {
  id: string;
  cols: number;
  rows: number;
  hours: number;
  south: number;
  north: number;
  west: number;
  lonSpan: number;
  full: boolean;
  times: number[];
  temp: Float32Array;
  rain: Float32Array;
  u: Float32Array;
  v: Float32Array;
  spd: Float32Array;
  /** ضغط سطح البحر بالهكتوباسكال. يُستخدم لمحاور المنخفضات فقط. */
  msl: Float32Array;
  /** غيوم ماطرة ٠–١٠٠. ليست سرعة الريح. */
  cloud: Float32Array;
  /** هطول ثلج بالسنتيمتر في الساعة. صفر حيث لا ثلج يتساقط. */
  snow: Float32Array;
  /** عمق الثلج على الأرض بالمتر. صفر فوق البحر والأرض العارية. */
  snowDepth: Float32Array;
  ok: Uint8Array;
};

export type FieldSample = {
  temp: number;
  rain: number;
  spd: number;
  u: number;
  v: number;
  dirFrom: number;
  dirTo: number;
  /** غطاء الغيوم الماطرة ٠–١٠٠، إن وُجد. */
  cloud?: number;
  /** هطول الثلج سم/ساعة. */
  snow?: number;
  /** عمق الثلج على الأرض بالمتر. */
  snowDepth?: number;
};

export const CACHE_KEY = "myweather-cache-v6";
export const PREFS_KEY = "myweather-prefs-v2";
export const CACHE_TTL_MS = 20 * 60 * 1000;
export const MAX_CACHED_PLACES = 24;

export const DEFAULT_PREFS: Prefs = {
  temp: "c",
  wind: "kmh",
  pressure: "hpa",
  distance: "km",
  lang: "system",
  theme: "sun",
  mapHours: 24,
  particles: "low",
  dataSaver: false,
  storms: true,
  mapLayer: 1,
  refreshMin: 15,
  alerts: true,
  wifiOnly: false,
  rainAlert: 0.2,
  windAlert: 45,
  dustAlert: 150,
  morning: "6:30",
  quiet: "23-7",
};

export const MUSCAT: Place = {
  id: "23.59,58.38",
  name: "مسقط",
  nameEn: "Muscat",
  country: "عُمان",
  countryEn: "Oman",
  admin: "مسقط",
  lat: 23.588,
  lon: 58.3829,
  primary: true,
};
