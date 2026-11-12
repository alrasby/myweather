import type { Map as LeafletMap } from "leaflet";
import { nearestWorldLongitude, windScreenStepDegrees } from "@/weather/windProjection";
import type { LiveCyclone } from "@/weather/cyclones";
import { covers, indexToMs, mercY, mercYView, sampleGrid } from "@/weather/grid";
import { buildLutBytes, colorAt, layerByKind, LAYERS } from "@/weather/layers";
import { paintCyclones, type PaintedSystem } from "@/weather/synoptic";
import type { FieldSample, GridField, Lang, ShadeKind, WindUnit } from "@/weather/types";
import { nextPlaybackHour, secondsPerForecastHour, shouldPaintWeatherFallback, shouldEmitRainFrame, needsRainOverlay, shouldUpdateRainOverlay, shouldUpdateRainFallback, rainClockWithoutGrid } from "@/weather/weatherPlayback";

/**
 * رسم الطبقات على WebGL2 (مزج زمني باليونيفورم فقط).
 * إن تعذّر RGBA16F ننزل إلى RGBA8 مع فك الترميز في الشيدر، ثم إلى Canvas 2D.
 * الجزيئات قماش ثانٍ فوق الطبقة، وتتوقف مع إخفاء الصفحة أو طبقة الحرارة.
 */

export type FrameInfo = {
  hour: number;
  timeMs: number;
  sample: FieldSample | null;
  estimated: boolean;
  /** True while the rain/snow clock is deliberately waiting for forecast data. */
  playbackWaitingMs: number;
};

const VERT = `#version 300 es
void main() {
  float x = gl_VertexID == 1 ? 3.0 : -1.0;
  float y = gl_VertexID == 2 ? 3.0 : -1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec4 u_view;
uniform vec4 u_grid;
uniform float u_full;
uniform int u_kind;
uniform float u_mix;
uniform vec2 u_range;
uniform float u_alphaMul;
uniform float u_bytes;
uniform float u_time;
uniform vec2 u_texSize;
uniform sampler2D u_tex0;
uniform sampler2D u_tex1;
uniform sampler2D u_cloud0;
uniform sampler2D u_cloud1;
uniform sampler2D u_lut;
out vec4 frag;

float normDelta(float d) {
  float x = mod(d + 180.0, 360.0);
  if (x < 0.0) x += 360.0;
  return x - 180.0;
}

vec4 decode(vec4 raw) {
  if (u_bytes > 0.5) {
    return vec4(raw.r * 100.0 - 40.0, raw.g * 40.0, raw.b * 180.0, raw.a);
  }
  return raw;
}

void main() {
  float x = gl_FragCoord.x / u_res.x;
  float y = 1.0 - gl_FragCoord.y / u_res.y;
  float lon = u_view.x + x * u_view.y;
  float merc = u_view.z - y * u_view.w;
  float v = (merc - u_grid.z) / max(u_grid.w, 0.0001);
  float u = u_full > 0.5
    ? (lon - u_grid.x) / max(u_grid.y, 0.0001)
    : normDelta(lon - u_grid.x) / max(u_grid.y, 0.0001);
  if (u_full > 0.5) {
    u = u - floor(u);
    // Do not stretch the northern/southern edge row into a horizontal band.
    if (u_kind == 2 && (v < 0.0 || v > 1.0)) {
      frag = vec4(0.0);
      return;
    }
    v = clamp(v, 0.0, 1.0);
  } else if (v < -0.03 || v > 1.03 || u < -0.002 || u > 1.002) {
    frag = vec4(0.0);
    return;
  }
  float edge = 1.0;
  if (u_full < 0.5) {
    // smoothstep requires ascending edges; reversed edges are undefined in GLSL.
    edge = smoothstep(-0.03, 0.0, v) * (1.0 - smoothstep(1.0, 1.03, v));
    edge *= smoothstep(-0.002, 0.01, u) * (1.0 - smoothstep(0.99, 1.002, u));
  } else if (u_kind == 2) {
    // Softly fade the rain field near polar data limits, not a hard horizontal cut.
    edge = smoothstep(0.0, 0.015, v) * (1.0 - smoothstep(0.985, 1.0, v));
  }
  float uu = u_full > 0.5 ? u : clamp(u, 0.0, 1.0);
  float vv = clamp(v, 0.0, 1.0);
  vec2 uv = vec2(uu, vv);
  vec4 s = mix(decode(texture(u_tex0, uv)), decode(texture(u_tex1, uv)), u_mix);
  if (u_kind != 2 && s.a < 0.5) {
    frag = vec4(0.0);
    return;
  }
  float temp = s.r;
  float mm = s.g;
  float spd = s.b;
  float span = max(u_range.y - u_range.x, 0.0001);
  vec3 col;
  float alpha;
  if (u_kind == 0) {
    float t = clamp((spd - u_range.x) / span, 0.0, 1.0);
    col = texture(u_lut, vec2(t, 0.5)).rgb;
    alpha = 0.5 * u_alphaMul;
  } else if (u_kind == 1) {
    float t = clamp((temp - u_range.x) / span, 0.0, 1.0);
    col = texture(u_lut, vec2(t, 0.5)).rgb;
    alpha = 0.74 * u_alphaMul;
  } else {
    mm = max(0.0, mm);
    vec4 sn = mix(texture(u_cloud0, uv), texture(u_cloud1, uv), u_mix);
    float fallCm = max(0.0, sn.r * 12.0);
    float rainBody = smoothstep(0.1, 0.65, mm);
    float snowBody = smoothstep(0.09, 0.33, fallCm);
    // Dense cloud banks remain recognizable; widespread light cloud must not
    // become a uniform white fog over the satellite base.
    // Spatial ECMWF provides cloud shapes; a coarse grid of hourly point
    // forecasts must never be rendered as fake, rectangular white clouds.
    float cloudBody = 0.0;
    if (s.a < 0.01 || (rainBody < 0.02 && snowBody < 0.02 && cloudBody < 0.02)) {
      frag = vec4(0.0);
      return;
    }
    float t = clamp((mm - u_range.x) / span, 0.0, 1.0);
    vec3 rainCol = texture(u_lut, vec2(t, 0.5)).rgb;
    float rainA = rainBody * mix(0.48, 0.95, smoothstep(0.5, 6.0, mm));
    vec3 snowCol = mix(vec3(0.62, 0.78, 0.96), vec3(0.97, 0.98, 1.0), snowBody);
    float snowA = snowBody * mix(0.68, 0.94, snowBody);
    float useSnow = snowBody / max(snowBody + rainBody, 0.001);
    vec3 wxCol = mix(rainCol, snowCol, useSnow);
    float wxA = mix(rainA, snowA, useSnow);
    float wx = clamp(max(rainBody, snowBody), 0.0, 1.0);
    col = mix(vec3(0.96, 0.97, 0.99), wxCol, wx);
    // Missing precipitation cells fade via their interpolated validity mask
    // rather than making hard square edges at the 50% threshold.
    alpha = mix(cloudBody * mix(0.28, 0.56, cloudBody), wxA, wx) * u_alphaMul * smoothstep(0.0, 1.0, s.a);
  }
  frag = vec4(col * alpha * edge, alpha * edge);
}`;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function floatToHalf(val: number): number {
  if (!Number.isFinite(val)) return val !== val ? 0x7e00 : val < 0 ? 0xfc00 : 0x7c00;
  f32[0] = val;
  const x = u32[0] ?? 0;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 255) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const halfExp = exp - 127 + 15;
  if (halfExp >= 31) return sign | 0x7c00;
  if (halfExp <= 0) {
    if (halfExp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - halfExp;
    let halfMant = mant >>> shift;
    const rest = mant & ((1 << shift) - 1);
    if (rest > 1 << (shift - 1)) halfMant += 1;
    return sign | halfMant;
  }
  let half = (sign | (halfExp << 10) | (mant >> 13)) & 0xffff;
  if (mant & 0x1000) half = (half + 1) & 0xffff;
  return half;
}

type Particle = { lat: number; lon: number; life: number; max: number; trail: { lat: number; lon: number }[] };

type DisplayField = {
  cols: number;
  rows: number;
  temp: Float32Array;
  rain: Float32Array;
  spd: Float32Array;
  ok: Uint8Array;
};

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** تكبير نسيج العرض: الحرارة والريح بمنحنًى محدود حتى تختفي مربعات الخلايا، والمطر بخطي حتى لا تنتفخ الزخة. */
function resampleField(grid: GridField, base: number): DisplayField {
  const { cols, rows, full } = grid;
  const scale = Math.max(cols, rows) <= 120 ? 3 : Math.max(cols, rows) <= 180 ? 2 : 1;
  if (scale === 1) {
    return {
      cols,
      rows,
      temp: grid.temp.subarray(base, base + cols * rows),
      rain: grid.rain.subarray(base, base + cols * rows),
      spd: grid.spd.subarray(base, base + cols * rows),
      ok: grid.ok.subarray(base, base + cols * rows),
    };
  }
  const dc = cols * scale;
  const dr = rows * scale;
  const temp = new Float32Array(dc * dr);
  const rain = new Float32Array(dc * dr);
  const spd = new Float32Array(dc * dr);
  const ok = new Uint8Array(dc * dr);
  const at = (c: number, r: number) => {
    if (full) c = ((c % cols) + cols) % cols;
    else c = Math.max(0, Math.min(cols - 1, c));
    r = Math.max(0, Math.min(rows - 1, r));
    return base + r * cols + c;
  };
  const bilinear = (src: Float32Array, x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const a = src[at(x0, y0)] ?? 0;
    const b = src[at(x0 + 1, y0)] ?? 0;
    const c = src[at(x0, y0 + 1)] ?? 0;
    const d = src[at(x0 + 1, y0 + 1)] ?? 0;
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const cubic = (src: Float32Array, x: number, y: number) => {
    const x1 = Math.floor(x);
    const y1 = Math.floor(y);
    const tx = x - x1;
    const ty = y - y1;
    const row = (yy: number) =>
      catmull(src[at(x1 - 1, yy)] ?? 0, src[at(x1, yy)] ?? 0, src[at(x1 + 1, yy)] ?? 0, src[at(x1 + 2, yy)] ?? 0, tx);
    const v = catmull(row(y1 - 1), row(y1), row(y1 + 1), row(y1 + 2), ty);
    let lo = Infinity;
    let hi = -Infinity;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const s = src[at(x1 + dx, y1 + dy)] ?? 0;
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
    }
    return Math.min(hi, Math.max(lo, v));
  };
  for (let r = 0; r < dr; r++) {
    const y = ((r + 0.5) / dr) * rows - 0.5;
    for (let c = 0; c < dc; c++) {
      const x = ((c + 0.5) / dc) * cols - 0.5;
      const i = r * dc + c;
      temp[i] = cubic(grid.temp, x, y);
      spd[i] = cubic(grid.spd, x, y);
      rain[i] = bilinear(grid.rain, x, y);
      const nc = Math.round(x);
      const nr = Math.round(y);
      ok[i] = grid.ok[at(nc, nr)] ? 1 : 0;
    }
  }
  return { cols: dc, rows: dr, temp, rain, spd, ok };
}

export class FieldEngine {
  hour = 0;
  playing = false;
  onFrame: ((info: FrameInfo) => void) | null = null;
  /** Optional gate for rain/snow timeline playback; wind and temperature
   * retain their original unrestricted playback cadence. */
  canAdvanceRainTime: ((timeMs: number) => boolean) | null = null;
  private weatherWaitSince: number | null = null;

  private map: LeafletMap | null = null;
  private fieldCanvas: HTMLCanvasElement;
  private partCanvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private byteMode = false;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private partCtx: CanvasRenderingContext2D | null = null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private lutTex: WebGLTexture[] = [];
  private blank: WebGLTexture | null = null;
  private textures = new Map<string, WebGLTexture>();
  private global: GridField | null = null;
  private detail: GridField | null = null;
  private rainWorld: GridField | null = null;
  private rainView: GridField | null = null;
  private kind: ShadeKind = 0;
  private hourMax = 47;
  private rainClockOriginMs = Date.now();
  private rainForecastTime(grid: GridField | null, hour: number): number {
    return grid ? indexToMs(grid.times, hour) : rainClockWithoutGrid(this.rainClockOriginMs, hour);
  }
  private particles: Particle[] = [];
  private particleTarget = 420;
  private paused = false;
  private dead = false;
  private raf = 0;
  private last = 0;
  private zoomSeen = -1;
  private dpr = 1;
  private windGestureActive = false;
  private onMoveStart = () => {
    if (this.kind !== 0) return;
    this.windGestureActive = true;
    // A screen-projected wind trail cannot survive a Leaflet pan/zoom:
    // its historical points refer to a different map transform. Keep
    // particle positions and original wind speed, discard only old paths.
    for (const p of this.particles) p.trail.length = 0;
    this.partCtx?.clearRect(0, 0, this.partCanvas.width, this.partCanvas.height);
  };
  private onMove = () => {
    this.windGestureActive = false;
    // The active RAF renders wind on the next display frame. Redrawing the
    // particle and shader canvases synchronously on Leaflet's moveend made
    // the map stutter exactly when the user released a fling.
    if (this.kind === 0) this.syncViewport();
    else this.drawField();
  };
  private onZoom = () => {
    // Wind traces are screen-projected from geographic coordinates; a zoom
    // transforms historical tail points disproportionately. Keep the particle
    // positions and count, but rebuild their trails after zoom settles.
    if (this.kind === 0) for (const p of this.particles) p.trail.length = 0;
    this.zoomSeen = this.map?.getZoom() ?? this.zoomSeen;
    this.windGestureActive = false;
    if (this.kind === 0) this.syncViewport();
    else this.drawField();
  };
  private settle = () => {
    this.drawField();
    this.drawParticles(0);
  };
  private saver = false;
  private lang: Lang = "ar";
  private windUnit: WindUnit = "kmh";
  private cyclones: LiveCyclone[] = [];
  private showCyclones = false;
  private systems: PaintedSystem[] = [];
  private frameBox: { north: number; south: number; west: number; east: number } | null = null;
  private modelCover = false;
  private lastRainEmitAt = 0;
  private lastRainOverlayAt = 0;
  private lastRainFallbackPaintAt = 0;
  private whirl = 0;

  constructor(private host: HTMLElement) {
    this.fieldCanvas = document.createElement("canvas");
    this.partCanvas = document.createElement("canvas");
    for (const canvas of [this.fieldCanvas, this.partCanvas]) {
      canvas.style.position = "absolute";
      canvas.style.left = "0";
      canvas.style.top = "0";
      canvas.style.pointerEvents = "none";
    }
    this.fieldCanvas.className = "wx-field";
    this.partCanvas.className = "wx-parts";
    this.fieldCanvas.style.zIndex = "450";
    this.partCanvas.style.zIndex = "460";
    this.partCtx = this.partCanvas.getContext("2d");
  }

  attach(map: LeafletMap) {
    this.map = map;
    const root = map.getContainer();
    root.appendChild(this.fieldCanvas);
    root.appendChild(this.partCanvas);
    try {
      this.bootGl();
    } catch {
      this.fallback2d();
    }
    // requestAnimationFrame already redraws during gestures. Avoid redundant
    // synchronous WebGL draws on every Leaflet move/zoom event.
    map.on("movestart", this.onMoveStart);
    map.on("zoomstart", this.onMoveStart);
    map.on("moveend", this.onMove);
    map.on("zoomend", this.onZoom);
    map.on("viewreset", this.onMove);
    map.on("resize", this.settle);
    this.resize();
    this.kick();
  }

  setGlobal(grid: GridField | null) {
    if (this.global?.id !== grid?.id) this.dropTextures();
    this.global = grid;
    if (grid) this.hourMax = Math.max(0, grid.hours - 1);
    this.drawField();
  }

  setDetail(grid: GridField | null) {
    if (this.detail?.id !== grid?.id) this.dropTextures();
    this.detail = grid;
    this.drawField();
  }

  /** شبكة مطر عالمية أدق. لا تُستخدم للحرارة ولا للرياح. */
  setRainWorld(grid: GridField | null) {
    if (this.rainWorld?.id === grid?.id) {
      if (this.kind === 2) this.drawField();
      return;
    }
    this.forgetTextures(this.rainWorld?.id);
    this.rainWorld = grid;
    if (this.kind === 2) this.drawField();
  }

  /** شبكة المطر للمنطقة الظاهرة. أدق من العالمية، ولا تُرسم إن نقص تغطيتها. */
  setRainView(grid: GridField | null) {
    if (this.rainView?.id === grid?.id) return;
    this.forgetTextures(this.rainView?.id);
    this.rainView = grid;
    if (this.kind === 2) this.drawField();
  }

  setKind(kind: ShadeKind) {
    if (kind === 2 && this.kind !== 2) this.rainClockOriginMs = Date.now();
    this.kind = kind;
    this.weatherWaitSince = null;
    this.lastRainEmitAt = 0;
    this.lastRainOverlayAt = 0;
    this.lastRainFallbackPaintAt = 0;
    this.particles = [];
    this.clearParticles();
    this.drawField();
  }

  /** طبقة المطر تُرسم من حقل النموذج؛ القماش يبقى للأعاصير فقط. */
  setModelCover(on: boolean) {
    if (this.modelCover === on) return;
    this.modelCover = on;
    if (on) this.particles = [];
    this.drawField();
    this.clearParticles();
  }

  setHour(hour: number) {
    this.hour = Math.max(0, Math.min(this.hourMax, hour));
    this.drawField();
  }

  setPlaying(on: boolean) {
    this.playing = on;
    if (!on) this.weatherWaitSince = null;
    if (on) this.kick();
  }

  setParticleCount(n: number) {
    this.particleTarget = n;
    if (this.particles.length > n) this.particles.length = n;
  }

  setPaused(on: boolean) {
    this.paused = on;
    if (!on) this.kick();
    else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  setSaver(on: boolean) {
    this.saver = on;
  }

  setOverlay(lang: Lang, unit: WindUnit) {
    this.lang = lang;
    this.windUnit = unit;
  }

  setCyclones(list: LiveCyclone[]) {
    this.cyclones = list;
    if (this.kind === 2) {
      // Clear dismissed systems and repaint changed marker positions once.
      this.clearParticles();
      this.lastRainOverlayAt = 0;
      if (needsRainOverlay(this.showCyclones, list.length)) {
        this.syncViewport();
        this.drawParticles(0);
      } else this.systems = [];
    }
  }

  setShowCyclones(on: boolean) {
    this.showCyclones = on;
    if (this.kind === 2) {
      this.clearParticles();
      this.lastRainOverlayAt = 0;
      if (needsRainOverlay(on, this.cyclones.length)) {
        this.syncViewport();
        this.drawParticles(0);
      } else this.systems = [];
    }
  }

  activeGrid(): GridField | null {
    return this.pick();
  }

  /** A real measured/forecast precipitation grid is available for the
   * current hour. Do not count the estimated initial bootstrap grid. */
  hasSourceRain(): boolean {
    if (this.kind !== 2) return false;
    const grid = this.pick();
    return !!grid && !grid.id.startsWith("est|") &&
      Number.isFinite(grid.hours) && grid.hours > 0;
  }

  sampleAt(lat: number, lon: number): FieldSample | null {
    const grid = this.pick();
    if (!grid) return null;
    return sampleGrid(grid, lat, lon, this.hour);
  }

  hitTest(lat: number, lon: number): PaintedSystem | null {
    const map = this.map;
    if (!map || !this.systems.length) return null;
    const click = map.latLngToContainerPoint([lat, lon]);
    let best: PaintedSystem | null = null;
    let bestD = 48;
    for (const sys of this.systems) {
      if (sys.kind !== "cyclone") continue;
      const p = map.latLngToContainerPoint([sys.lat, sys.lon]);
      const d = Math.hypot(p.x - click.x, p.y - click.y);
      if (d < 22 && d < bestD) {
        best = sys;
        bestD = d;
      }
    }
    if (best) return best;
    return null;
  }

  resize() {
    this.drawField();
  }

  destroy() {
    this.dead = true;
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.windGestureActive = false;
    this.map?.off("movestart", this.onMoveStart);
    this.map?.off("zoomstart", this.onMoveStart);
    this.map?.off("moveend", this.onMove);
    this.map?.off("zoomend", this.onZoom);
    this.map?.off("viewreset", this.onMove);
    this.map?.off("resize", this.settle);
    this.dropTextures();
    if (this.gl) {
      for (const tex of this.lutTex) this.gl.deleteTexture(tex);
      if (this.blank) this.gl.deleteTexture(this.blank);
      if (this.prog) this.gl.deleteProgram(this.prog);
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.fieldCanvas.remove();
    this.partCanvas.remove();
    this.map = null;
  }

  private bootGl() {
    const gl = this.fieldCanvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      depth: false,
      antialias: false,
    });
    if (!gl) {
      this.ctx2d = this.fieldCanvas.getContext("2d");
      return;
    }
    this.gl = gl;
    gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_float_linear");
    const vs = this.compile(gl.VERTEX_SHADER, VERT);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) {
      this.fallback2d();
      return;
    }
    const prog = gl.createProgram();
    if (!prog) {
      this.fallback2d();
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(prog) || "link");
      this.fallback2d();
      return;
    }
    this.prog = prog;
    for (const name of [
      "u_res",
      "u_view",
      "u_grid",
      "u_full",
      "u_kind",
      "u_mix",
      "u_range",
      "u_alphaMul",
      "u_bytes",
      "u_time",
      "u_texSize",
      "u_tex0",
      "u_tex1",
      "u_cloud0",
      "u_cloud1",
      "u_lut",
    ]) {
      this.loc[name] = gl.getUniformLocation(prog, name);
    }
    this.probeHalf(gl);
    this.byteMode = true;
    this.blank = this.makeBlank(gl);
    this.lutTex = LAYERS.map((layer) => this.makeLut(gl, buildLutBytes(layer)));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private fallback2d() {
    if (this.gl) {
      this.gl.getExtension("WEBGL_lose_context")?.loseContext();
      this.gl = null;
      this.prog = null;
    }
    this.ctx2d = this.fieldCanvas.getContext("2d");
    if (this.ctx2d) return;
    const next = document.createElement("canvas");
    next.className = this.fieldCanvas.className;
    next.style.cssText = this.fieldCanvas.style.cssText;
    this.fieldCanvas.replaceWith(next);
    this.fieldCanvas = next;
    this.ctx2d = next.getContext("2d");
  }

  private compile(type: number, src: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(sh) || "shader");
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  private probeHalf(gl: WebGL2RenderingContext): boolean {
    const tex = gl.createTexture();
    if (!tex) return false;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, new Uint16Array([0, 0, 0, floatToHalf(1)]));
    } catch {
      gl.deleteTexture(tex);
      return false;
    }
    const err = gl.getError();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const err2 = gl.getError();
    gl.deleteTexture(tex);
    return err === gl.NO_ERROR && err2 === gl.NO_ERROR;
  }

  private makeBlank(gl: WebGL2RenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeLut(gl: WebGL2RenderingContext, bytes: Uint8Array): WebGLTexture {
    const tex = gl.createTexture();
    if (!tex) throw new Error("lut");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private pick(): GridField | null {
    if (this.kind === 2) {
      const world = this.rainWorld;
      const view = this.rainView;
      if (view && this.detailFillsView(view)) {
        const viewCell = view.lonSpan / Math.max(1, view.cols);
        const worldCell = world ? world.lonSpan / Math.max(1, world.cols) : 99;
        if ((!world || viewCell < worldCell * 0.85) && viewCell < 4.2) return view;
      }
      if (world) return world;
      // The initial global grid may be estimateGrid(). Never sample it as
      // real precipitation (or let a missing model fabricate rain on a map).
      // Only a successfully fetched rain/world/view or measured detail
      // can supply rainfall until the official spatial frame is ready.
      if (this.detail && this.detailFillsView(this.detail) &&
          !this.detail.id.startsWith("est|")) return this.detail;
      // The wind/heat global grid is also fetched from Open-Meteo and
      // contains real precipitation fields. Reuse it if present, but NEVER
      // use the synthetic estimateGrid() bootstrap as a rain forecast.
      if (this.global && !this.global.id.startsWith("est|")) return this.global;
      return null;
    }
    if (this.detail && this.detailFillsView(this.detail)) return this.detail;
    return this.global ?? this.detail;
  }

  /** الشبكة الدقيقة تُرسم فقط إذا غطت الشاشة كلها، وإلا تبقى العالمية تحتها. */
  private detailFillsView(grid: GridField): boolean {
    const box = this.frameBox;
    if (!box) return false;
    return covers(grid, { south: box.south, north: box.north, west: box.west, east: box.east });
  }

  private paintGrids(): GridField[] {
    const grid = this.pick();
    return grid ? [grid] : [];
  }

  /** القماش بحجم الشاشة دائمًا، والإحداثيات هي حدود ما يراه المستخدم الآن. */
  private syncViewport() {
    const map = this.map;
    if (!map) return;
    const size = map.getSize();
    if (size.x < 2 || size.y < 2) return;
    this.dpr = Math.min(this.saver ? 1 : window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.min(2048, Math.floor(size.x * this.dpr)));
    const h = Math.max(1, Math.min(2048, Math.floor(size.y * this.dpr)));
    for (const canvas of [this.fieldCanvas, this.partCanvas]) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const cssW = `${size.x}px`;
      const cssH = `${size.y}px`;
      if (canvas.style.width !== cssW) canvas.style.width = cssW;
      if (canvas.style.height !== cssH) canvas.style.height = cssH;
      if (canvas.style.left !== "0px") canvas.style.left = "0px";
      if (canvas.style.top !== "0px") canvas.style.top = "0px";
      if (canvas.style.transform !== "none") canvas.style.transform = "none";
    }
    const nw = map.containerPointToLatLng([0, 0]);
    const se = map.containerPointToLatLng([size.x, size.y]);
    let west = nw.lng;
    let east = se.lng;
    if (east < west) east += 360;
    if (east - west > 360) {
      const mid = (west + east) / 2;
      west = mid - 180;
      east = mid + 180;
    }
    this.frameBox = { north: nw.lat, south: se.lat, west, east };
  }

  private local(lat: number, lon: number): { x: number; y: number } | null {
    const map = this.map;
    if (!map) return null;
    const p = map.latLngToContainerPoint([lat, nearestWorldLongitude(lon, map.getCenter().lng)]);
    return { x: p.x, y: p.y };
  }

  private kick() {
    if (this.raf || this.dead || this.paused) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    this.raf = 0;
    if (this.dead || this.paused) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.whirl += dt;
    if (this.playing) {
      const grid = this.pick();
      const max = grid ? Math.max(0, grid.hours - 1) : this.hourMax;
      this.hourMax = max;
      const step = nextPlaybackHour(
        this.hour, dt, max, secondsPerForecastHour(this.kind),
        (candidate) => this.kind !== 2 || !this.canAdvanceRainTime ||
          this.canAdvanceRainTime(this.rainForecastTime(grid, candidate)),
      );
      this.hour = step.hour;
      if (step.waiting) this.weatherWaitSince ??= now;
      else this.weatherWaitSince = null;
    }
    const hasRainOverlay = needsRainOverlay(this.showCyclones, this.cyclones.length);
    // The hidden fallback frameBox is irrelevant while ECMWF covers the map
    // and no cyclone marker is enabled. Avoid Leaflet coordinate conversion,
    // canvas style checks and re-sizing on every 60fps frame.
    const cycloneDue = hasRainOverlay && shouldUpdateRainOverlay(now, this.lastRainOverlayAt);
    // Weather-mode fallback draws at 10Hz rather than burning CPU/GPU at 60Hz
    // while workers decode three ECMWF .om raster layers. Wind/temperature
    // retain their original per-frame paint behaviour.
    const fallbackDue = shouldPaintWeatherFallback(this.kind, this.modelCover) &&
      (this.kind !== 2 || shouldUpdateRainFallback(now, this.lastRainFallbackPaintAt));
    if (this.kind !== 2 || cycloneDue) this.pinView();
    if (fallbackDue) {
      if (this.kind === 2) this.lastRainFallbackPaintAt = now;
      this.drawField();
    }
    if (this.kind !== 2 || cycloneDue) {
      if (this.kind === 2) this.lastRainOverlayAt = now;
      this.drawParticles(dt);
    }
    this.emit();
    this.raf = requestAnimationFrame(this.frame);
  };

  private emit() {
    if (!this.onFrame) return;
    if (this.kind === 2) {
      const now = performance.now();
      if (!shouldEmitRainFrame(now, this.lastRainEmitAt)) return;
      this.lastRainEmitAt = now;
    }
    const grid = this.pick();
    const timeMs = this.kind === 2 ? this.rainForecastTime(grid, this.hour) : grid ? indexToMs(grid.times, this.hour) : Date.now();
    let sample: FieldSample | null = null;
    if (grid && this.map) {
      const c = this.map.getCenter();
      sample = sampleGrid(grid, c.lat, c.lng, this.hour);
    }
    this.onFrame({
      hour: this.hour,
      timeMs,
      sample,
      estimated: !!grid?.id.startsWith("est|"),
      playbackWaitingMs: this.playing && this.kind === 2 && this.weatherWaitSince !== null
        ? Math.max(0, performance.now() - this.weatherWaitSince)
        : 0,
    });
  }

  private pinView() {
    this.syncViewport();
  }

  private drawField() {
    if (!this.map || this.map.getSize().x < 2 || this.map.getSize().y < 2) return;
    this.syncViewport();
    const grid = this.pick();
    if (this.gl && this.prog) this.drawGl();
    else this.draw2d();
    if (!grid && this.gl) {
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  private blend(hours = this.hourMax + 1): { h0: number; h1: number; t: number } {
    const max = Math.max(0, hours - 1);
    const clamped = Math.max(0, Math.min(max, this.hour));
    const h0 = Math.floor(clamped);
    const h1 = Math.min(max, h0 + 1);
    return { h0, h1, t: clamped - h0 };
  }

  private drawGl() {
    const gl = this.gl;
    const prog = this.prog;
    const map = this.map;
    if (!gl || !prog || !map) return;
    gl.viewport(0, 0, this.fieldCanvas.width, this.fieldCanvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (this.modelCover && this.kind === 2) return;
    if (!this.frameBox) return;
    const grids = this.paintGrids();
    if (!grids.length) return;
    gl.useProgram(prog);
    for (const grid of grids) {
      if (this.kind === 2 && grid.id.startsWith("est|")) continue;
      this.drawGrid(gl, grid);
    }
  }

  private drawGrid(gl: WebGL2RenderingContext, grid: GridField) {
    const box = this.frameBox;
    if (!box) return;
    const span = Math.max(0.01, box.east - box.west);
    const mercN = mercYView(box.north);
    const mercS = mercYView(box.south);
    const { h0, h1, t } = this.blend(grid.hours);
    const layer = layerByKind(this.kind);
    gl.uniform2f(this.loc.u_res ?? null, this.fieldCanvas.width, this.fieldCanvas.height);
    gl.uniform4f(this.loc.u_view ?? null, box.west, span, mercN, Math.max(0.0001, mercN - mercS));
    gl.uniform4f(this.loc.u_grid ?? null, grid.west, grid.lonSpan, mercY(grid.south), mercY(grid.north) - mercY(grid.south));
    gl.uniform1f(this.loc.u_full ?? null, grid.full ? 1 : 0);
    gl.uniform1i(this.loc.u_kind ?? null, this.kind);
    gl.uniform1f(this.loc.u_mix ?? null, t);
    gl.uniform2f(this.loc.u_range ?? null, layer.range[0], layer.range[1]);
    gl.uniform1f(this.loc.u_alphaMul ?? null, 1);
    gl.uniform1f(this.loc.u_bytes ?? null, this.byteMode ? 1 : 0);
    gl.uniform1f(this.loc.u_time ?? null, performance.now() / 1000);
    gl.uniform2f(this.loc.u_texSize ?? null, grid.cols, grid.rows);
    this.bindTex(0, this.texFor(grid, h0), "u_tex0");
    this.bindTex(1, this.texFor(grid, h1), "u_tex1");
    if (this.kind === 2) {
      this.bindTex(3, this.cloudTexFor(grid, h0), "u_cloud0");
      this.bindTex(4, this.cloudTexFor(grid, h1), "u_cloud1");
    } else {
      this.bindTex(3, this.blank, "u_cloud0");
      this.bindTex(4, this.blank, "u_cloud1");
    }
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex[this.kind] ?? null);
    gl.uniform1i(this.loc.u_lut ?? null, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bindTex(unit: number, tex: WebGLTexture | null, uniform: string) {
    const gl = this.gl;
    if (!gl) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex ?? this.blank);
    gl.uniform1i(this.loc[uniform] ?? null, unit);
  }

  private texFor(grid: GridField, hour: number): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const h = Math.max(0, Math.min(grid.hours - 1, hour));
    const key = `${grid.id}:${h}:${this.byteMode ? "b" : "f"}`;
    const hit = this.textures.get(key);
    if (hit) {
      this.textures.delete(key);
      this.textures.set(key, hit);
      return hit;
    }
    const tex = this.upload(grid, h);
    if (!tex) return this.blank;
    this.textures.set(key, tex);
    while (this.textures.size > 64) {
      const first = this.textures.keys().next().value;
      if (first === undefined) break;
      const old = this.textures.get(first);
      this.textures.delete(first);
      if (old) gl.deleteTexture(old);
    }
    return tex;
  }

  private upload(grid: GridField, hour: number): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const { cols, rows } = grid;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    while (gl.getError() !== gl.NO_ERROR) {
      /* تفريغ أخطاء سابقة حتى لا نُسقط نسيجًا سليمًا */
    }
    const base = hour * rows * cols;
    const field = resampleField(grid, base);
    if (this.byteMode) {
      const data = new Uint8Array(field.cols * field.rows * 4);
      for (let i = 0; i < field.cols * field.rows; i++) {
        const pix = i * 4;
        data[pix] = Math.max(0, Math.min(255, Math.round((((field.temp[i] ?? 0) + 40) / 100) * 255)));
        data[pix + 1] = Math.max(0, Math.min(255, Math.round(((field.rain[i] ?? 0) / 40) * 255)));
        data[pix + 2] = Math.max(0, Math.min(255, Math.round(((field.spd[i] ?? 0) / 180) * 255)));
        data[pix + 3] = field.ok[i] ? 255 : 0;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, field.cols, field.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
      const data = new Uint16Array(field.cols * field.rows * 4);
      for (let i = 0; i < field.cols * field.rows; i++) {
        const pix = i * 4;
        data[pix] = floatToHalf(field.temp[i] ?? 0);
        data[pix + 1] = floatToHalf(field.rain[i] ?? 0);
        data[pix + 2] = floatToHalf(field.spd[i] ?? 0);
        data[pix + 3] = floatToHalf(field.ok[i] ? 1 : 0);
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, field.cols, field.rows, 0, gl.RGBA, gl.HALF_FLOAT, data);
    }
    if (gl.getError() !== gl.NO_ERROR) {
      gl.deleteTexture(tex);
      if (!this.byteMode) {
        this.byteMode = true;
        return this.upload(grid, hour);
      }
      return null;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, grid.full ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** غيوم الساعة وأبيضها في الأزرق، والثلج المتساقط فقط في الأحمر. */
  private cloudTexFor(grid: GridField, hour: number): WebGLTexture | null {
    const gl = this.gl;
    // Snowfall is independent of snow depth on the ground. Never suppress
    // falling snow simply because the provider omitted snow-depth samples.
    if (!gl || !grid.snow) return this.blank;
    const h = Math.max(0, Math.min(grid.hours - 1, hour));
    const key = `${grid.id}:${h}:snow`;
    const hit = this.textures.get(key);
    if (hit) {
      this.textures.delete(key);
      this.textures.set(key, hit);
      return hit;
    }
    const tex = gl.createTexture();
    if (!tex) return this.blank;
    const { cols, rows, full } = grid;
    const scale = Math.max(cols, rows) <= 120 ? 3 : Math.max(cols, rows) <= 180 ? 2 : 1;
    const dc = cols * scale;
    const dr = rows * scale;
    const base = h * rows * cols;
    const snow = grid.snow;
    const at = (arr: Float32Array, c: number, r: number) => {
      if (full) c = ((c % cols) + cols) % cols;
      else c = Math.max(0, Math.min(cols - 1, c));
      r = Math.max(0, Math.min(rows - 1, r));
      return arr[base + r * cols + c] ?? 0;
    };
    const bilinear = (arr: Float32Array, x: number, y: number) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const tx = x - x0;
      const ty = y - y0;
      const a = at(arr, x0, y0);
      const b = at(arr, x0 + 1, y0);
      const c = at(arr, x0, y0 + 1);
      const d = at(arr, x0 + 1, y0 + 1);
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    const data = new Uint8Array(dc * dr * 4);
    for (let r = 0; r < dr; r++) {
      const y = scale === 1 ? r : ((r + 0.5) / dr) * rows - 0.5;
      for (let c = 0; c < dc; c++) {
        const x = scale === 1 ? c : ((c + 0.5) / dc) * cols - 0.5;
        const pix = (r * dc + c) * 4;
        const cm = scale === 1 ? at(snow, c, r) : bilinear(snow, x, y);
        const cover = grid.cloud ? (scale === 1 ? at(grid.cloud, c, r) : bilinear(grid.cloud, x, y)) : 0;
        data[pix] = Math.max(0, Math.min(255, Math.round((cm / 12) * 255)));
        data[pix + 1] = 0;
        data[pix + 2] = Math.max(0, Math.min(255, Math.round((cover / 100) * 255)));
        data[pix + 3] = 255;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, dc, dr, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, full ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(key, tex);
    while (this.textures.size > 64) {
      const first = this.textures.keys().next().value;
      if (first === undefined) break;
      const old = this.textures.get(first);
      this.textures.delete(first);
      if (old) gl.deleteTexture(old);
    }
    return tex;
  }

  private dropTextures() {
    const gl = this.gl;
    if (!gl) return;
    for (const tex of this.textures.values()) gl.deleteTexture(tex);
    this.textures.clear();
  }

  private forgetTextures(id?: string) {
    const gl = this.gl;
    if (!id || !gl) return;
    for (const key of [...this.textures.keys()]) {
      if (!key.startsWith(`${id}:`)) continue;
      const tex = this.textures.get(key);
      this.textures.delete(key);
      if (tex) gl.deleteTexture(tex);
    }
  }

  private draw2d() {
    const ctx = this.ctx2d;
    const map = this.map;
    if (!ctx || !map) return;
    const w = this.fieldCanvas.width;
    const h = this.fieldCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.modelCover && this.kind === 2) return;
    const grids = this.paintGrids();
    if (!grids.length || !this.frameBox) return;
    const box = this.frameBox;
    const span = Math.max(0.01, box.east - box.west);
    for (let i = 0; i < grids.length; i++) {
      const grid = grids[i]!;
      if (this.kind === 2 && grid.id.startsWith("est|")) continue;
      const { h0, h1, t } = this.blend(grid.hours);
      if (i > 0) {
        ctx.save();
        ctx.globalAlpha = 1;
      }
      this.blitHour(ctx, grid, h0, box.west, span, box.north, box.south, 1);
      if (t > 0.01 && h1 !== h0) {
        ctx.save();
        ctx.globalAlpha = t;
        this.blitHour(ctx, grid, h1, box.west, span, box.north, box.south, t);
        ctx.restore();
      }
      if (i > 0) ctx.restore();
    }
  }

  private blitHour(
    ctx: CanvasRenderingContext2D,
    grid: GridField,
    hour: number,
    west: number,
    span: number,
    north: number,
    south: number,
    alphaMul: number,
  ) {
    const step = 6;
    const w = this.fieldCanvas.width;
    const h = this.fieldCanvas.height;
    const layer = layerByKind(this.kind);
    for (let y = 0; y < h; y += step) {
      const fy = y / h;
      const merc = mercYView(north) - fy * (mercYView(north) - mercYView(south));
      const lat = grid.full ? Math.max(grid.south, Math.min(grid.north, (Math.atan(Math.sinh(merc)) * 180) / Math.PI)) : (Math.atan(Math.sinh(merc)) * 180) / Math.PI;
      if (!grid.full && (lat < grid.south || lat > grid.north)) continue;
      for (let x = 0; x < w; x += step) {
        const lon = west + (x / w) * span;
        const s = sampleGrid(grid, lat, lon, hour);
        if (!s) continue;
        const color = shade(this.kind, s, layer.range, alphaMul);
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  private clearParticles() {
    const ctx = this.partCtx;
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.partCanvas.width, this.partCanvas.height);
  }

  private drawParticles(dt: number) {
    if (!this.map || !this.partCtx) return;
    const flow = this.kind === 0 && !this.saver && this.particleTarget > 0;
    if (!flow) {
      this.clearParticles();
      this.paintOverlay();
      return;
    }
    const grid = this.pick();
    const ctx = this.partCtx;
    const box = this.frameBox;
    const cssW = this.partCanvas.width / this.dpr;
    const cssH = this.partCanvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!grid || !box) {
      this.paintOverlay();
      return;
    }
    const rain = this.kind === 2;
    const zoomNow = this.map?.getZoom() ?? 0;
    if (this.kind === 0 && this.zoomSeen >= 0 && Math.abs(zoomNow - this.zoomSeen) > 0.35) {
      for (const p of this.particles) p.trail.length = 0;
    }
    this.zoomSeen = zoomNow;
    const cap = this.kind === 2 ? Math.max(this.particleTarget, 680) : this.particleTarget;
    let born = 0;
    const bornCap = 110;
    while (this.particles.length < cap && born < bornCap) {
      born += 1;
      const spawned = this.spawn(grid);
      if (!spawned) {
        if (rain) continue;
        break;
      }
      this.particles.push(spawned);
    }
    if (this.particles.length > cap) this.particles.length = cap;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    // Keep 60Hz wind animation and the same native U/V speed. During a
    // physical map gesture only, draw half the wind streamlines so Leaflet
    // can transform imagery without competing with hundreds of polyline
    // projections. The full density returns on release automatically.
    const stride = this.kind === 0 && this.windGestureActive ? 2 : 1;
    for (let i = 0; i < this.particles.length; i += stride) {
      const p = this.particles[i]!;
      p.life -= dt * (rain ? 0.32 : 0.28);
      const sample = sampleGrid(grid, p.lat, p.lon, this.hour);
      const here = this.local(p.lat, p.lon);
      const snowHere = (sample?.snow ?? 0) >= 0.03 || (sample?.snowDepth ?? 0) >= 0.02;
      const rainOk = !rain || snowHere;
      const outside = !here || here.x < -48 || here.y < -48 || here.x > cssW + 48 || here.y > cssH + 48;
      if (!sample || p.life <= 0 || outside || !rainOk || !here) {
        const next = this.spawn(grid);
        if (!next) {
          p.life = 0;
          continue;
        }
        p.lat = next.lat;
        p.lon = next.lon;
        p.life = next.life;
        p.max = next.max;
        p.trail = next.trail;
        continue;
      }
      if (dt > 0 && !rain) this.advect(p, sample, dt, 1);
      const fade = this.fade(p, rain);
      if (fade < 0.04) continue;
      if (rain) this.strokeRain(ctx, p, sample, fade, sample.snow ?? 0);
      else this.strokeWind(ctx, p, sample, fade);
    }
    this.zoomSeen = this.map?.getZoom() ?? this.zoomSeen;
    this.paintOverlay();
  }

  /** سرعة الشاشة تتبع كم/س. الأثر خط عرض/طول فيبقى على الخريطة عند التحريك. */
  private advect(p: Particle, sample: FieldSample, dt: number, scale = 1) {
    const map = this.map;
    if (!map) return;
    const grid = this.pick();
    let lat = p.lat;
    let lon = p.lon;
    let cur = sample;
    const steps = 2;
    for (let s = 0; s < steps; s++) {
      const moved = this.windStep(lat, lon, cur, (dt * scale) / steps);
      if (!moved) break;
      lat = moved.lat;
      lon = moved.lon;
      if (grid && s + 1 < steps) {
        const next = sampleGrid(grid, lat, lon, this.hour);
        if (next) cur = next;
      }
    }
    p.lat = lat;
    p.lon = lon;
    this.pushTrail(p);
  }

  private windStep(lat: number, lon: number, sample: FieldSample, dt: number): { lat: number; lon: number } | null {
    const map = this.map;
    if (!map || dt <= 0) return null;
    const mag = Math.hypot(sample.u, sample.v);
    const spd = Math.max(sample.spd, mag);
    if (spd < 0.5 || mag < 0.3) return null;
    const zoom = map.getZoom();
    const zoomScale = zoom < 3 ? 0.62 : zoom < 5 ? 0.84 : zoom < 7 ? 1 : 1.08;
    const pxPerSec = Math.min(34, Math.max(10, 8 + spd * 0.28)) * zoomScale;
    const delta = windScreenStepDegrees(lat, zoom, pxPerSec, dt);
    let nlat = lat + (sample.v / mag) * delta.latitude;
    let nlon = lon + (sample.u / mag) * delta.longitude;
    if (nlat > 84) nlat = 84;
    if (nlat < -78) nlat = -78;
    if (nlon > 180) nlon -= 360;
    if (nlon < -180) nlon += 360;
    return { lat: nlat, lon: nlon };
  }

  private pushTrail(p: Particle) {
    const last = p.trail[p.trail.length - 1];
    if (!last) {
      p.trail.push({ lat: p.lat, lon: p.lon });
      return;
    }
    const head = this.local(p.lat, p.lon);
    const prev = head ? this.local(last.lat, last.lon) : null;
    if (!head || !prev || Math.hypot(head.x - prev.x, head.y - prev.y) >= 2.2) {
      p.trail.push({ lat: p.lat, lon: p.lon });
    }
    this.trimTrail(p, 38);
  }

  /** A bounded smooth streamline follows real U/V motion, not a 14px dash. */
  private trimTrail(p: Particle, maxPx: number) {
    while (p.trail.length > 2) {
      const tail = this.local(p.trail[0]!.lat, p.trail[0]!.lon);
      const head = this.local(p.trail[p.trail.length - 1]!.lat, p.trail[p.trail.length - 1]!.lon);
      const long = p.trail.length > 14 || (!!tail && !!head && Math.hypot(head.x - tail.x, head.y - tail.y) > maxPx);
      if (!long) break;
      p.trail.shift();
    }
  }

  private fade(p: Particle, rain = false): number {
    const age = Math.max(0, p.max - p.life);
    if (rain) return Math.min(1, age / 0.16, p.life / 0.4);
    return Math.min(1, age / 0.25, p.life / 0.45);
  }

  private strokeWind(ctx: CanvasRenderingContext2D, p: Particle, sample: FieldSample, fade: number) {
    const pts = p.trail;
    if (pts.length < 2) return;
    const xy: { x: number; y: number }[] = [];
    for (const t of pts) {
      const loc = this.local(t.lat, t.lon);
      if (!loc) continue;
      const prev = xy[xy.length - 1];
      if (prev && Math.hypot(loc.x - prev.x, loc.y - prev.y) > 150) {
        if (xy.length >= 2) this.paintThread(ctx, xy, sample, fade);
        xy.length = 0;
      }
      xy.push(loc);
    }
    if (xy.length >= 2) this.paintThread(ctx, xy, sample, fade);
  }

  /** Gently curved, head-lit wind streamlines. Same particle budget/frame
   * cadence as before; no shadowBlur, offscreen canvas, or extra animation.
   * A single thin gradient stroke gives a transparent tail and a bright head.
   */
  private paintThread(
    ctx: CanvasRenderingContext2D,
    xy: { x: number; y: number }[],
    _sample: FieldSample,
    fade: number,
  ) {
    const tail = xy[0]!;
    const head = xy[xy.length - 1]!;
    if (Math.hypot(head.x - tail.x, head.y - tail.y) < 2) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    for (let i = 1; i < xy.length - 1; i++) {
      const here = xy[i]!;
      const next = xy[i + 1]!;
      ctx.quadraticCurveTo(here.x, here.y,
        (here.x + next.x) / 2, (here.y + next.y) / 2);
    }
    ctx.lineTo(head.x, head.y);
    const light = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
    light.addColorStop(0, "rgba(238,248,255,0)");
    light.addColorStop(0.35, `rgba(240,249,255,${(0.24 * fade).toFixed(3)})`);
    light.addColorStop(1, `rgba(255,255,255,${(0.82 * fade).toFixed(3)})`);
    ctx.strokeStyle = light;
    ctx.stroke();
  }

  private strokeRain(ctx: CanvasRenderingContext2D, p: Particle, _sample: FieldSample, fade: number, _mm: number) {
    const here = this.local(p.lat, p.lon);
    if (!here) return;
    const r = 2.1;
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(255,255,255,${(0.82 * fade).toFixed(3)})`;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (Math.PI / 3) * k + 0.4;
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r;
      ctx.moveTo(here.x - dx, here.y - dy);
      ctx.lineTo(here.x + dx, here.y + dy);
    }
    ctx.stroke();
  }

  private paintOverlay() {
    const ctx = this.partCtx;
    if (!ctx || !this.frameBox) {
      this.systems = [];
      return;
    }
    if (!this.showCyclones || !this.cyclones.length) {
      this.systems = [];
      return;
    }
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.systems = paintCyclones(
      ctx,
      (lat, lon) => this.local(lat, lon) ?? { x: -9999, y: -9999 },
      this.cyclones,
      this.whirl,
    );
    ctx.restore();
  }

  private spawn(grid: GridField): Particle | null {
    if (this.kind === 2) return this.spawnRain(grid);
    const box = this.frameBox;
    const map = this.map;
    if (!box || !map) return null;
    for (let i = 0; i < 8; i++) {
      const lat = box.south + Math.random() * (box.north - box.south);
      let lon = box.west + Math.random() * Math.max(0.01, box.east - box.west);
      if (lon > 180) lon -= 360;
      const sample = sampleGrid(grid, lat, lon, this.hour);
      if (!sample || sample.spd < 1.2) continue;
      const max = 2.6 + Math.random() * 2.2;
      return { lat, lon, life: max, max, trail: this.seedWindTrail(grid, lat, lon, sample) };
    }
    return null;
  }

  /** ذيل جاهز عكس الريح حتى يظهر الخيط فوراً لا كنقطة. */
  private seedWindTrail(grid: GridField, lat: number, lon: number, sample: FieldSample): { lat: number; lon: number }[] {
    const map = this.map;
    const back: { lat: number; lon: number }[] = [];
    if (!map) return [{ lat, lon }];
    let la = lat;
    let lo = lon;
    let cur = sample;
    const zoom = map.getZoom();
    const pxPerDeg = (256 * 2 ** zoom) / 360;
    const deg = 2.4 / Math.max(8, pxPerDeg);
    for (let i = 0; i < 8; i++) {
      const mag = Math.hypot(cur.u, cur.v);
      if (mag < 0.3) break;
      const cos = Math.max(0.22, Math.cos((la * Math.PI) / 180));
      la -= (cur.v / mag) * deg;
      lo -= ((cur.u / mag) * deg) / cos;
      if (lo > 180) lo -= 360;
      if (lo < -180) lo += 360;
      if (la > 84 || la < -78) break;
      back.push({ lat: la, lon: lo });
      const next = sampleGrid(grid, la, lo, this.hour);
      if (!next) break;
      cur = next;
    }
    back.reverse();
    back.push({ lat, lon });
    return back;
  }

  /** المطر والثلج لون متصل فقط، بلا نجوم ولا علامات. */
  private spawnRain(_grid: GridField): Particle | null {
    return null;
  }
}

function shade(
  kind: ShadeKind,
  s: FieldSample,
  range: [number, number],
  alphaMul: number,
): string | null {
  const layer = layerByKind(kind);
  if (kind === 2) {
    const snowCm = Math.max(s.snow ?? 0, 0);
    const rainBody = smooth(0.1, 0.65, s.rain);
    const snowBody = smooth(0.09, 0.33, snowCm);
    // Continuous point-grid is a precipitation-only fallback, not a cloud
    // image; the spatial layer paints real model-based cloud structure.
    const cloudBody = 0;
    if (rainBody < 0.02 && snowBody < 0.02 && cloudBody < 0.02) return null;
    const rainA = rainBody * (0.48 + smooth(0.5, 6, s.rain) * 0.47);
    const snowI = Math.max(0, Math.min(1, snowCm / 0.33));
    const sr = Math.round(158 + (247 - 158) * snowI);
    const sg = Math.round(199 + (250 - 199) * snowI);
    const sb = Math.round(245 + (255 - 245) * snowI);
    const snowA = snowBody * (0.68 + snowBody * 0.26);
    const useSnow = snowBody / Math.max(snowBody + rainBody, 0.001);
    const [rr, gg, bb] = colorAt(layer.stops, s.rain);
    const wx = Math.max(rainBody, snowBody);
    const r = Math.round((245 * (1 - wx) + (rr * (1 - useSnow) + sr * useSnow) * wx));
    const g = Math.round((247 * (1 - wx) + (gg * (1 - useSnow) + sg * useSnow) * wx));
    const b = Math.round((252 * (1 - wx) + (bb * (1 - useSnow) + sb * useSnow) * wx));
    const a = ((cloudBody * (0.28 + 0.28 * cloudBody)) * (1 - wx) + (rainA * (1 - useSnow) + snowA * useSnow) * wx) * alphaMul;
    return `rgba(${r},${g},${b},${Math.min(0.9, a).toFixed(3)})`;
  }
  const value = kind === 0 ? s.spd : s.temp;
  const [r, g, b] = colorAt(layer.stops, Math.max(range[0], Math.min(range[1], value)));
  const a = (kind === 0 ? 0.66 : 0.74) * alphaMul;
  return `rgba(${r},${g},${b},${a})`;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
}
