import type { Map as LeafletMap, TileLayer } from "leaflet";
import type * as Leaflet from "leaflet";

/** Public PNG forecast tiles, no API key. Hourly, maximum 72 hours. */
export type WeatherApiKind = "precip" | "tmp2m" | "wind" | "pressure";
export const WEATHER_API_KINDS: readonly WeatherApiKind[] = ["precip", "tmp2m", "wind", "pressure"];

const HOUR = 3_600_000;
export function weatherApiStamp(timeMs: number): string {
  const d = new Date(Math.floor(timeMs / HOUR) * HOUR);
  if (!Number.isFinite(d.getTime())) throw new Error("Invalid forecast time");
  return d.toISOString().slice(0, 13).replace(/[-T:]/g, "");
}
export function weatherApiTileUrl(kind: WeatherApiKind, timeMs: number): string {
  if (!WEATHER_API_KINDS.includes(kind)) throw new Error("Unsupported layer");
  return `https://weathermaps.weatherapi.com/${kind}/tiles/${weatherApiStamp(timeMs)}/{z}/{x}/{y}.png`;
}
export function weatherApiForecastTime(timeMs: number, nowMs: number): number | null {
  if (!Number.isFinite(timeMs) || !Number.isFinite(nowMs)) return null;
  const hour = Math.floor(timeMs / HOUR) * HOUR;
  const min = Math.floor(nowMs / HOUR) * HOUR;
  return hour < min || hour >= min + 72 * HOUR ? null : hour;
}

/** Two slots only: first visible frame persists until the next frame loads. */
export class WeatherApiTiles {
  private current: TileLayer | null = null;
  private incoming: TileLayer | null = null;
  private key = "";
  private requestKey = "";
  private retryAt = 0;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private dead = false;
  private onAvailability: (visible: boolean) => void;
  private now: () => number;

  constructor(
    private L: typeof Leaflet,
    private map: LeafletMap,
    onAvailability: (visible: boolean) => void,
    now: () => number = () => Date.now(),
  ) {
    this.onAvailability = onAvailability;
    this.now = now;
  }
  show(kind: WeatherApiKind, timeMs: number) {
    if (this.dead) return;
    const valid = weatherApiForecastTime(timeMs, this.now());
    if (valid == null) {
      this.hide();
      return;
    }
    const key = `${kind}:${weatherApiStamp(valid)}`;
    if (key === this.key || key === this.requestKey) return;
    if (this.now() < this.retryAt) return;
    this.clearIncoming();
    this.requestKey = key;
    let failed = false;
    const tile = this.L.tileLayer(weatherApiTileUrl(kind, valid), {
      pane: "wx-ready-tiles",
      opacity: 0,
      maxNativeZoom: 7,
      maxZoom: 16,
      keepBuffer: 1,
      updateWhenIdle: true,
      crossOrigin: true,
      className: "wx-ready-weather-tile",
    });
    tile.on("tileerror", () => { failed = true; });
    tile.on("load", () => {
      if (this.dead || tile !== this.incoming) return;
      if (failed) {
        this.retryAt = this.now() + 12_000;
        this.clearIncoming();
        return;
      }
      const old = this.current;
      this.incoming = null;
      this.current = tile;
      this.key = key;
      this.requestKey = "";
      if (this.timeout) clearTimeout(this.timeout);
      this.timeout = null;
      const container = tile.getContainer();
      if (container) container.style.transition = "opacity 240ms ease-out";
      tile.setOpacity(0.86);
      this.onAvailability(true);
      if (old) {
        // Remove after the CSS fade while retaining a complete old image.
        setTimeout(() => {
          if (old !== this.current && this.map.hasLayer(old)) this.map.removeLayer(old);
        }, 280);
      }
    });
    this.incoming = tile;
    tile.addTo(this.map);
    this.timeout = setTimeout(() => {
      if (this.incoming === tile) {
        this.retryAt = this.now() + 12_000;
        this.clearIncoming();
      }
    }, 9000);
  }
  hide() {
    this.clearIncoming();
    if (this.current) this.map.removeLayer(this.current);
    this.current = null;
    this.key = "";
    this.requestKey = "";
    this.onAvailability(false);
  }
  destroy() {
    this.dead = true;
    this.hide();
  }
  private clearIncoming() {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    if (this.incoming && this.map.hasLayer(this.incoming)) this.map.removeLayer(this.incoming);
    this.incoming = null;
    this.requestKey = "";
  }
}
