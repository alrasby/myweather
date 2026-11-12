import { useEffect, useRef, type CSSProperties } from "react";
import moonFace from "@/assets/moon-face.jpg";
import { heroAtmosphere } from "@/weather/heroAtmosphere";

type SkyKind = "clear" | "partly" | "cloud" | "storm";
type RGB = [number, number, number];
type Pal = { hi: RGB; mid: RGB; lo: RGB };
type CloudSprite = {
  canvas: HTMLCanvasElement;
  x0: number;
  y: number;
  w: number;
  speed: number;
  bob: number;
  amp: number;
  phase: number;
  alpha: number;
  flip: boolean;
  /** Fraction of the sky band height. Omit to keep the sprite aspect. */
  h?: number;
};

const STARS = Array.from({ length: 150 }, (_, i) => {
  const n = i + 1;
  const u = (k: number) => {
    const x = Math.sin(n * k) * 43758.5453;
    return x - Math.floor(x);
  };
  const mag = u(12.9898);
  const bright = mag > 0.94;
  const mid = mag > 0.78;
  return {
    left: `${(2 + u(78.233) * 96).toFixed(2)}%`,
    top: `${(Math.pow(u(39.346), 0.72) * 100).toFixed(2)}%`,
    size: bright ? 2 : mid ? 1.4 : 1.1,
    delay: `${(u(11.7) * 8).toFixed(2)}s`,
    dur: `${(3.4 + u(17.3) * 5).toFixed(2)}s`,
    lo: bright ? 0.5 : mid ? 0.3 : 0.18,
    hi: bright ? 1 : mid ? 0.78 : 0.52,
    tone: mag > 0.9 ? "#fff8ea" : mag > 0.5 ? "#f4f7ff" : "#d5e2f4",
    glow: bright ? 1.2 : 0,
  };
});

const PERM = (() => {
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = i;
  let s = 20260311;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    const t = src[i]!;
    src[i] = src[j]!;
    src[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = src[i & 255]!;
  return p;
})();

function skyKind(code: number): SkyKind {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3 || code === 45 || code === 48) return "cloud";
  return "storm";
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function noise2(x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const u = fade(xf);
  const v = fade(yf);
  const X = x0 & 255;
  const Y = y0 & 255;
  const aa = PERM[PERM[X]! + Y]!;
  const ba = PERM[PERM[X + 1]! + Y]!;
  const ab = PERM[PERM[X]! + Y + 1]!;
  const bb = PERM[PERM[X + 1]! + Y + 1]!;
  const g = (h: number, dx: number, dy: number) => {
    switch (h & 3) {
      case 0:
        return dx + dy;
      case 1:
        return -dx + dy;
      case 2:
        return dx - dy;
      default:
        return -dx - dy;
    }
  };
  return lerp(lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u), lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u), v);
}

function fbm(x: number, y: number, oct = 5) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    v += a * noise2(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return v / n;
}

function smooth(e0: number, e1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function shade(lit: number, pal: Pal): RGB {
  const t = Math.min(1, Math.max(0, lit));
  const a = t < 0.5 ? pal.lo : pal.mid;
  const b = t < 0.5 ? pal.mid : pal.hi;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function bake(w: number, h: number, pal: Pal, sample: (nx: number, ny: number) => { a: number; lit: number }) {
  const raw = document.createElement("canvas");
  raw.width = w;
  raw.height = h;
  const rctx = raw.getContext("2d");
  if (!rctx) return raw;
  const img = rctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = x / (w - 1);
      const ny = y / (h - 1);
      const s = sample(nx, ny);
      const rgb = shade(s.lit, pal);
      const a = Math.min(1, Math.max(0, s.a));
      const i = (y * w + x) * 4;
      d[i] = rgb[0];
      d[i + 1] = rgb[1];
      d[i + 2] = rgb[2];
      d[i + 3] = Math.round(a * 255);
    }
  }
  rctx.putImageData(img, 0, 0);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return raw;
  ctx.filter = "blur(0.4px)";
  ctx.drawImage(raw, 0, 0);
  return out;
}

function cirrusSample(nx: number, ny: number, seed: number) {
  const y0 = 0.42 + Math.sin(nx * Math.PI * 2.2 + seed) * 0.12 + fbm(nx * 1.3 + seed, 1.7, 3) * 0.1;
  const band = Math.exp(-((ny - y0) * (ny - y0)) / 0.012);
  const streak = smooth(0.18, 0.72, fbm(nx * 1.4 + seed, ny * 5, 3) * 0.5 + 0.5);
  const fadeX = smooth(0, 0.16, nx) * smooth(0, 0.16, 1 - nx);
  return { a: band * streak * fadeX * 0.7, lit: 0.78 + (1 - ny) * 0.16 };
}

const CIRRUS_DAY: Pal = { hi: [255, 255, 255], mid: [236, 246, 255], lo: [198, 220, 238] };

const CUMULUS_DAY: Pal = { hi: [255, 255, 255], mid: [233, 245, 254], lo: [166, 195, 220] };
const CUMULUS_NIGHT: Pal = { hi: [217, 233, 251], mid: [143, 179, 214], lo: [80, 110, 147] };

/** Clusters of rounded billows with irregular cloud edges and soft shading;
 * unlike the old cirrus line, no part spans the entire viewport horizontally.
 */
function cumulusSample(nx: number, ny: number, seed: number) {
  const lumps = [
    [0.18, 0.68, 0.21, 0.19],
    [0.35, 0.49, 0.20, 0.28],
    [0.53, 0.60, 0.26, 0.24],
    [0.72, 0.48, 0.19, 0.27],
    [0.83, 0.70, 0.15, 0.17],
  ] as const;
  let shape = 0;
  for (const [cx, cy, rx, ry] of lumps) {
    const x = (nx - cx) / rx;
    const y = (ny - cy) / ry;
    shape = Math.max(shape, Math.exp(-1.6 * (x * x + y * y)));
  }
  const detail = fbm(nx * 6.5 + seed, ny * 6 + seed * 0.3, 4);
  const edge = smooth(0.17, 0.58, shape + detail * 0.25);
  const horizon = smooth(0.06, 0.18, ny) * smooth(0.05, 0.21, 1 - ny);
  return { a: edge * horizon * 0.95, lit: 0.60 + (1 - ny) * 0.26 + detail * 0.20 };
}


type VeilKind = "day-partly" | "day-cloud" | "day-storm" | "night-cloud" | "night-storm" | "night-partly";

function veilKind(day: boolean, code: number): VeilKind | null {
  const kind = skyKind(code);
  if (kind === "storm") return day ? "day-storm" : "night-storm";
  if (kind === "cloud") return day ? "day-cloud" : "night-cloud";
  // Partly cloudy skies use individual textured cloud clusters, not a
  // full-width atmospheric band that collapses visually into a thin line.
  if (kind === "partly") return null;
  return null;
}

type AtmoField = { canvas: HTMLCanvasElement };

function hash3(ix: number, iy: number, iz: number) {
  return PERM[PERM[PERM[ix & 255]! + (iy & 255)]! + (iz & 255)]! / 255;
}

function vnoise(x: number, y: number, z: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const yf = y - y0;
  const zf = z - z0;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const n000 = hash3(x0, y0, z0);
  const n100 = hash3(x0 + 1, y0, z0);
  const n010 = hash3(x0, y0 + 1, z0);
  const n110 = hash3(x0 + 1, y0 + 1, z0);
  const n001 = hash3(x0, y0, z0 + 1);
  const n101 = hash3(x0 + 1, y0, z0 + 1);
  const n011 = hash3(x0, y0 + 1, z0 + 1);
  const n111 = hash3(x0 + 1, y0 + 1, z0 + 1);
  return lerp(lerp(lerp(n000, n100, u), lerp(n010, n110, u), v), lerp(lerp(n001, n101, u), lerp(n011, n111, u), v), w);
}

function fbm3(x: number, y: number, z: number, oct = 4) {
  let val = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    val += a * vnoise(x * f, y * f, z * f);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return val / n;
}

function loopPoint(nx: number, ny: number, sx: number, sy: number, spin: number) {
  const theta = nx * Math.PI * 2 + spin;
  const r = sx / (2 * Math.PI);
  return { x: r * Math.cos(theta), y: ny * sy, z: r * Math.sin(theta) };
}

function cloudN(nx: number, ny: number, sx: number, sy: number, seed: number, warp: number) {
  const p = loopPoint(nx, ny, sx, sy, 0);
  const wy = fbm3(p.x + seed, p.y + 4.2, p.z + 1.7, 3);
  const wz = fbm3(p.x + seed + 8.1, p.y + 1.4, p.z + 6.3, 3);
  const q = loopPoint(nx, ny + (wy - 0.5) * warp * 0.28, sx, sy, 0);
  return fbm3(q.x + (wz - 0.5) * warp * 0.12, q.y, q.z + seed, 4);
}

function angdist(nx: number, center: number) {
  const d = Math.abs(nx - center);
  return Math.min(d, 1 - d);
}

function fit(n: number) {
  return Math.min(1, Math.max(0, (n - 0.4) / 0.34));
}

function yBand(ny: number, center: number, spread: number) {
  const d = ny - center;
  return Math.exp(-(d * d) / spread);
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const u = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function sampleAtmo(kind: VeilKind, nx: number, ny: number): { r: number; g: number; b: number; a: number } {
  if (kind === "night-partly") {
    const n = fit(cloudN(nx, ny, 3.2, 2.5, 2.4, 1.15));
    const fine = fit(cloudN(nx, ny, 4.8, 3.6, 9.2, 0.55));
    const edge = fit(cloudN(nx, ny, 2.4, 1.7, 33.0, 0.4));
    const cx = 0.16 + (edge - 0.5) * 0.16;
    const cy = 0.18 + (n - 0.5) * 0.06;
    const blob = Math.exp(-(angdist(nx, cx) ** 2) / 0.078) * Math.exp(-((ny - cy) ** 2) / 0.062);
    const cover = smooth(0.12, 0.58, blob + (edge - 0.5) * 0.22);
    const dens = smooth(0.2, 0.7, n * 0.65 + fine * 0.35);
    const a = Math.min(0.74, cover * (0.58 + 0.42 * dens));
    const rgb = mixRgb([168, 198, 234], [252, 254, 255], 0.12 + 0.88 * fine);
    return { r: rgb[0], g: rgb[1], b: rgb[2], a };
  }
  if (kind === "night-storm") {
    const n = fit(cloudN(nx, ny, 2.9, 2.2, 4.8, 1.05));
    const fine = fit(cloudN(nx, ny, 4.6, 3.4, 11.4, 0.5));
    const edge = fit(cloudN(nx, ny, 2.1, 1.6, 28.0, 0.35));
    const upper = smooth(0.92, 0.0, ny);
    const side = Math.exp(-(angdist(nx, 0.22) ** 2) / 0.16);
    const cover = smooth(0.18, 0.62, upper * (0.55 + 0.45 * side) + (edge - 0.5) * 0.28 + (n - 0.5) * 0.18);
    const pocket = Math.exp(-(angdist(nx, 0.86) ** 2) / 0.035) * smooth(0.28, 0.78, ny);
    const dens = smooth(0.22, 0.68, n * 0.6 + fine * 0.4);
    const a = Math.min(0.78, cover * (0.5 + 0.5 * dens) * (1 - 0.72 * pocket));
    const rgb = mixRgb([162, 192, 228], [236, 244, 252], 0.2 + 0.8 * fine);
    return { r: rgb[0], g: rgb[1], b: rgb[2], a };
  }
  if (kind === "night-cloud") {
    const y = ny;
    const n = fit(cloudN(nx, y, 2.5, 1.25, 6.6, 0.75));
    const m = fit(cloudN(nx, y, 4.1, 1.8, 14.2, 0.36));
    const lit = smooth(0.08, 0.92, n * 0.52 + m * 0.48);
    const rgb = mixRgb([86, 102, 122], [176, 190, 206], 0.38 + 0.62 * lit);
    return { r: rgb[0], g: rgb[1], b: rgb[2], a: 0.94 };
  }
  if (kind === "day-cloud") {
    const y = ny;
    const n = fit(cloudN(nx, y, 2.4, 1.2, 5.2, 0.72));
    const m = fit(cloudN(nx, y, 3.9, 1.7, 12.4, 0.34));
    const lit = smooth(0.08, 0.92, n * 0.52 + m * 0.48);
    const rgb = mixRgb([150, 166, 182], [248, 250, 253], 0.34 + 0.66 * lit);
    return { r: rgb[0], g: rgb[1], b: rgb[2], a: 0.93 };
  }
  if (kind === "day-storm") {
    const n = fit(cloudN(nx, ny, 2.8, 2.2, 7.5, 1.0));
    const m = fit(cloudN(nx, ny, 4.5, 3.5, 15.4, 0.5));
    const lit = smooth(0.1, 0.9, n * 0.55 + m * 0.45);
    const rgb = mixRgb([40, 52, 68], [132, 146, 162], lit);
    return { r: rgb[0], g: rgb[1], b: rgb[2], a: 0.95 };
  }
  const n = fit(cloudN(nx, ny, 1.8, 7.2, 3.8, 0.7));
  const brk = fit(cloudN(nx, ny, 3.8, 3.0, 17.1, 0.3));
  const streak = smooth(0.52, 0.84, n);
  const band = yBand(ny, 0.1, 0.01) * 0.75 + yBand(ny, 0.28, 0.007) * 0.5 + yBand(ny, 0.46, 0.006) * 0.28;
  return { r: 255, g: 255, b: 255, a: Math.min(0.42, streak * (0.2 + 0.8 * brk) * band * 0.72) };
}

function bakeAtmo(kind: VeilKind) {
  const w = 420;
  const h = 560;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const ny = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const s = sampleAtmo(kind, x / w, ny);
      const i = (y * w + x) * 4;
      d[i] = s.r;
      d[i + 1] = s.g;
      d[i + 2] = s.b;
      d[i + 3] = Math.round(Math.min(1, Math.max(0, s.a)) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const atmoCache = new Map<VeilKind, AtmoField>();

function atmoOf(kind: VeilKind): AtmoField {
  const hit = atmoCache.get(kind);
  if (hit) return hit;
  const field = { canvas: bakeAtmo(kind) };
  atmoCache.set(kind, field);
  return field;
}

const spriteCache = new Map<string, CloudSprite[]>();

function makeSprites(day: boolean, code: number): CloudSprite[] {
  const kind = skyKind(code);
  const key = `v6:${day ? 1 : 0}:${kind}:${code > 0 ? 1 : 0}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const cirrus = () => bake(520, 160, CIRRUS_DAY, (nx, ny) => cirrusSample(nx, ny, kind === "partly" ? 1.4 : 2.6));
  let layers: CloudSprite[] = [];
  if (day && kind === "clear" && code > 0) {
    layers = [
      {
        canvas: cirrus(),
        x0: 0.15,
        y: 0.02,
        w: 1.2,
        speed: 3.2,
        bob: 0.08,
        amp: 2,
        phase: 0.4,
        alpha: 0.28,
        flip: false,
      },
    ];
  } else if (kind === "partly") {
    const palette = day ? CUMULUS_DAY : CUMULUS_NIGHT;
    layers = [
      {
        canvas: bake(420, 220, palette, (nx, ny) => cumulusSample(nx, ny, 1.2)),
        x0: 0.06, y: 0.02, w: 0.72, speed: 2.3, bob: 0.10,
        amp: 2.4, phase: 0.2, alpha: day ? 0.79 : 0.68, flip: false,
      },
      {
        canvas: bake(420, 220, palette, (nx, ny) => cumulusSample(nx, ny, 3.9)),
        x0: 0.60, y: 0.18, w: 0.59, speed: -1.4, bob: 0.07,
        amp: 2.0, phase: 1.4, alpha: day ? 0.66 : 0.53, flip: true,
      },
    ];
  }
  spriteCache.set(key, layers);
  return layers;
}

function CloudField({ day, code, cover }: { day: boolean; code: number; cover: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const kind = skyKind(code);
  const veil = veilKind(day, code);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let alive = true;
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mode = veilKind(day, code);
    const field = mode ? atmoOf(mode) : null;
    const clouds = mode ? [] : makeSprites(day, code);
    const paint = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) return;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      try {
        ctx.imageSmoothingQuality = "high";
      } catch {
        /* بعض متصفحات الجوال */
      }
      const t = reduce ? 0 : now / 1000;
      if (mode && field) {
        const dw = w * 1.42;
        const sceneH = canvas.parentElement?.clientHeight || h;
        const deckDraw = mode.endsWith("cloud") || mode.endsWith("storm");
        const dh = mode.endsWith("partly") ? h / 0.4 : deckDraw ? h : Math.max(sceneH, h);
        const v = w * (mode === "day-partly" ? 0.016 : mode.endsWith("cloud") || mode === "day-storm" ? 0.007 : 0.011);
        const span = dw;
        const x0 = -((((t * v) % span) + span) % span);
        ctx.globalAlpha = 1;
        // Neighboring copies shared a fractional-pixel gap on high-DPR
        // Chromium WebViews, visible as a moving vertical light line.
        // Overlap only the rasterized cloud texture by one device pixel;
        // keep its period, motion and weather-specific generation unchanged.
        const overlap = 1 / dpr;
        ctx.drawImage(field.canvas, x0, 0, dw + overlap, dh);
        ctx.drawImage(field.canvas, x0 + span, 0, dw + overlap, dh);
        return;
      }
      const scale = w / 390;
      const opacityScale = kind === "partly"
        ? 0.4 + 0.6 * Math.max(0, Math.min(100, Number.isFinite(cover) ? cover : 50)) / 100
        : 1;
      for (const cloud of clouds) {
        const sw = w * cloud.w;
        const sh = cloud.h ? h * cloud.h : sw * (cloud.canvas.height / cloud.canvas.width);
        const span = w + sw;
        const travel = reduce ? 0 : t * cloud.speed * scale;
        const x = ((cloud.x0 * span + travel) % span + span) % span - sw;
        const y = h * cloud.y + (reduce ? 0 : Math.sin(t * cloud.bob + cloud.phase) * cloud.amp);
        ctx.save();
        ctx.globalAlpha = cloud.alpha * opacityScale;
        ctx.translate(cloud.flip ? x + sw : x, y);
        ctx.scale(cloud.flip ? -1 : 1, 1);
        ctx.drawImage(cloud.canvas, 0, 0, sw, sh);
        ctx.restore();
      }
    };
    const loop = (now: number) => {
      if (!alive) return;
      paint(now);
      if (!reduce) raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => paint(performance.now()));
    ro.observe(canvas);
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [day, code, cover]);
  if (!veil && !(kind === "partly" || (day && kind === "clear" && code > 0))) return null;
  const deck = kind === "cloud" || kind === "storm";
  return <canvas ref={ref} className={`sky-clouds${kind === "partly" ? " is-puffs" : veil ? (deck ? " is-deck" : " is-veil") : ""}`} aria-hidden="true" />;
}

/** Original, locally rendered cloud bank for the top HOME WEATHER HERO only.
 * Reuses the existing procedural cumulus baker: no images, new data requests,
 * WebGL contexts or whole-screen overlays. The one canvas is clipped to its
 * card and suspended when scrolled offscreen or in the background.
 */
const heroSpriteCache = new Map<string, HTMLCanvasElement[]>();

function heroCloudTextures(day: boolean, storm: boolean): HTMLCanvasElement[] {
  const key = `${day ? "day" : "night"}:${storm ? "storm" : "soft"}`;
  const cached = heroSpriteCache.get(key);
  if (cached) return cached;
  const pal: Pal = storm
    ? day
      ? { hi: [220, 228, 238], mid: [133, 155, 181], lo: [68, 83, 108] }
      : { hi: [191, 205, 224], mid: [112, 137, 169], lo: [59, 79, 110] }
    : day ? CUMULUS_DAY : CUMULUS_NIGHT;
  const textures = [0.8, 2.7, 4.4].map((seed) =>
    bake(336, 160, pal, (nx, ny) => cumulusSample(nx, ny, seed)));
  heroSpriteCache.set(key, textures);
  return textures;
}

export function HeroClouds({ day, code, cover, wind, direction }: {
  day: boolean; code: number; cover: number; wind: number; direction: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const plan = heroAtmosphere(code, cover, wind);
    if (plan.clouds === 0 && plan.precipitation === "none") return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const textures = plan.clouds ? heroCloudTextures(day, plan.dark) : [];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sign = Number.isFinite(direction) && Math.sin(direction * Math.PI / 180) > 0 ? -1 : 1;
    let alive = true;
    let visible = !document.hidden;
    let intersecting = true;
    let raf = 0;
    let timer = 0;
    const start = performance.now();

    const paint = (now: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 4 || h < 4) return;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1, 820 / w, 360 / h);
      const pw = Math.max(1, Math.round(w * ratio));
      const ph = Math.max(1, Math.round(h * ratio));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = reduceMotion ? 0 : Math.max(0, (now - start) / 1000);
      for (let i = 0; i < plan.clouds; i++) {
        const sprite = textures[i]!;
        const sw = w * (i === 0 ? 0.83 : i === 1 ? 0.67 : 0.76);
        const sh = Math.min(h * 1.12, sw * sprite.height / sprite.width);
        const baseX = w * (0.08 + i * 0.37) - sw * 0.28;
        const cycle = w + sw;
        const dx = sign * t * plan.driftPxPerSecond * (i === 0 ? 0.73 : i === 1 ? 1.08 : 0.88);
        const x = (((baseX + dx + sw) % cycle) + cycle) % cycle - sw;
        const y = h * (i === 0 ? 0.01 : i === 1 ? 0.28 : 0.44)
          + (reduceMotion ? 0 : Math.sin(t * 0.23 + i * 2) * 1.4);
        ctx.globalAlpha = plan.opacity * (i === 0 ? 0.83 : i === 1 ? 0.68 : 0.56);
        ctx.drawImage(sprite, x, y, sw, sh);
        if (x + sw < w) ctx.drawImage(sprite, x + cycle, y, sw, sh);
      }
      // Keep precipitation sparse and in the hero only. It represents WMO
      // weather state, not fake real-time particle positions over the map.
      if (plan.precipitation !== "none") {
        const snow = plan.precipitation === "snow";
        const count = Math.round(10 + plan.coverage * 20);
        const speed = snow ? 11 : 61;
        ctx.globalAlpha = snow ? 0.69 : 0.33;
        ctx.lineWidth = snow ? 1.1 : 0.85;
        ctx.strokeStyle = snow ? "#edf8ff" : "#d5efff";
        ctx.fillStyle = "#f5fbff";
        for (let i = 0; i < count; i++) {
          const u = ((Math.sin((i + 1) * 63.21) * 43758.5453) % 1 + 1) % 1;
          const v = ((Math.sin((i + 1) * 17.37) * 21732.913) % 1 + 1) % 1;
          const x = ((u * w + sign * t * (snow ? 2 : 9)) % w + w) % w;
          const y = ((v * (h + 20) + t * speed * (0.68 + (i % 5) * 0.12)) % (h + 20)) - 10;
          if (snow) {
            ctx.beginPath();
            ctx.arc(x, y, 0.65 + (i % 3) * 0.32, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - sign * 1.5, y + 6.5 + (i % 3));
            ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    };

    const schedule = () => {
      if (!alive || !visible || !intersecting) return;
      if (reduceMotion) { paint(performance.now()); return; }
      if (!raf && !timer) raf = window.requestAnimationFrame(frame);
    };
    const frame = (stamp: number) => {
      raf = 0;
      if (!alive || !visible || !intersecting) return;
      paint(stamp);
      // The cloud field changes slowly: ~15 FPS instead of 60 FPS and no
      // work at all when the card is offscreen.
      timer = window.setTimeout(() => {
        timer = 0;
        schedule();
      }, 65);
    };
    const pause = () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
      raf = 0;
      timer = 0;
    };
    const onVisibility = () => {
      visible = !document.hidden;
      if (visible) schedule();
      else pause();
    };
    const observer = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          intersecting = !!entries[0]?.isIntersecting;
          if (intersecting) schedule();
          else pause();
        }, { threshold: 0.01 })
      : null;
    observer?.observe(canvas);
    const resize = new ResizeObserver(() => {
      if (reduceMotion) paint(performance.now());
      else if (visible && intersecting) schedule();
    });
    resize.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      alive = false;
      pause();
      observer?.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [day, code, cover, wind, direction]);
  return (
    <div className="wx-hero-atmosphere" aria-hidden="true" data-hero-weather="localized">
      <canvas ref={ref} />
    </div>
  );
}

export function SkyBackdrop({ day, code, phase, cover, showClouds = true }: { day: boolean; code: number; phase: number; cover: number; showClouds?: boolean }) {
  const kind = skyKind(code);
  return (
    <div className={`sky-scene sky-${kind} ${day ? "is-day" : "is-night-sky"}`} aria-hidden="true">
      {!day ? (
        <div className="sky-stars">
          {STARS.map((star, i) => (
            <span
              key={i}
              className="sky-star"
              style={
                {
                  left: star.left,
                  top: star.top,
                  width: star.size,
                  height: star.size,
                  "--d": star.dur,
                  "--delay": star.delay,
                  "--lo": star.lo,
                  "--hi": star.hi,
                  "--tone": star.tone,
                  "--glow": `${star.glow}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      {showClouds ? <CloudField day={day} code={code} cover={cover} /> : null}
      <div className="sky-column">
        {day && kind !== "cloud" && kind !== "storm" ? (
          <div className="sky-sun" />
        ) : !day ? (
          <MoonDisc phase={phase} sizeClass="sky-moon" shadeId="sky" />
        ) : null}
      </div>
    </div>
  );
}

/** Shadow of the unlit side. Phase 0 = new, 0.25 = first quarter (right lit), 0.5 = full, 0.75 = last quarter (left lit). */
function shadowPath(phase: number): string {
  const p = ((phase % 1) + 1) % 1;
  if (Math.abs(p - 0.5) < 0.02) return "";
  const r = 50;
  const k = Math.cos(p * Math.PI * 2);
  const samples = 48;
  const term: string[] = [];
  const limb: string[] = [];
  const darkOnRight = p > 0.5;
  for (let i = 0; i <= samples; i++) {
    const yy = 50 - r * Math.cos((Math.PI * i) / samples);
    const dy = yy - 50;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    const tx = 50 + k * half;
    term.push(`${tx.toFixed(2)} ${yy.toFixed(2)}`);
    const reach = Math.min(86, half + 36);
    const lx = darkOnRight ? 50 + reach : 50 - reach;
    limb.push(`${lx.toFixed(2)} ${yy.toFixed(2)}`);
  }
  limb.reverse();
  return `M ${term.join(" L ")} L ${limb.join(" L ")} Z`;
}

export function MoonDisc({ phase, sizeClass, shadeId }: { phase: number; sizeClass: string; shadeId: string }) {
  const d = shadowPath(phase);
  return (
    <span className={`moon-disc ${sizeClass}`}>
      <img src={moonFace} alt="" draggable={false} />
      {d ? (
        <svg className="moon-shade" viewBox="0 0 100 100" data-shade={shadeId} aria-hidden="true">
          <path d={d} fill="#142033" fillOpacity="0.7" />
        </svg>
      ) : null}
    </span>
  );
}