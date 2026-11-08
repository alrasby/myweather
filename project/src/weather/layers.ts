import type { ShadeKind } from "@/weather/types";

/**
 * سجل الطبقات: إضافة طبقة = وقف لوني واحد هنا.
 * المحرك يبني LUT ‏256×1 من هذه الوقفات — لا ألوان متناثرة في الشيدر.
 */
export type Stop = { v: number; hex: string };

export type LayerDef = {
  id: ShadeKind;
  key: "windLayer" | "tempLayer" | "rainLayer";
  unit: string;
  range: [number, number];
  alpha: number;
  stops: Stop[];
};

export const LAYERS: readonly LayerDef[] = [
  {
    id: 0,
    key: "windLayer",
    unit: "km/h",
    range: [0, 100],
    alpha: 0.66,
    stops: [
      { v: 0, hex: "#4C3AB0" },
      { v: 10, hex: "#2478DC" },
      { v: 20, hex: "#10BAB0" },
      { v: 35, hex: "#38C448" },
      { v: 55, hex: "#D6D624" },
      { v: 70, hex: "#F08018" },
      { v: 100, hex: "#D62830" },
    ],
  },
  {
    id: 1,
    key: "tempLayer",
    unit: "°C",
    range: [-10, 52],
    alpha: 0.74,
    stops: [
      { v: -10, hex: "#1240D8" },
      { v: 0, hex: "#2AA8FF" },
      { v: 10, hex: "#3EE08A" },
      { v: 20, hex: "#D6F04A" },
      { v: 30, hex: "#FFB01A" },
      { v: 40, hex: "#FF4E12" },
      { v: 52, hex: "#C41414" },
    ],
  },
  {
    id: 2,
    key: "rainLayer",
    unit: "mm",
    range: [0, 16],
    alpha: 0.9,
    stops: [
      { v: 0, hex: "#8ed4f8" },
      { v: 0.4, hex: "#3aa6e4" },
      { v: 1.2, hex: "#2fce8a" },
      { v: 3, hex: "#c6e24a" },
      { v: 6, hex: "#f0c430" },
      { v: 9, hex: "#f07818" },
      { v: 12, hex: "#e23a28" },
      { v: 16, hex: "#9b2fd0" },
    ],
  },
] as const;

export function layerByKind(kind: ShadeKind): LayerDef {
  return LAYERS[kind] ?? LAYERS[0];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function colorAt(stops: readonly Stop[], value: number): [number, number, number] {
  if (value <= stops[0]!.v) return hexToRgb(stops[0]!.hex);
  const last = stops[stops.length - 1]!;
  if (value >= last.v) return hexToRgb(last.hex);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (value >= a.v && value <= b.v) {
      const t = (value - a.v) / (b.v - a.v || 1);
      const ca = hexToRgb(a.hex);
      const cb = hexToRgb(b.hex);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * t),
        Math.round(ca[1] + (cb[1] - ca[1]) * t),
        Math.round(ca[2] + (cb[2] - ca[2]) * t),
      ];
    }
  }
  return hexToRgb(last.hex);
}

/** ست تسميات موزّعة على مدى الطبقة لوسيلة الإيضاح. */
export function legendTicks(layer: LayerDef): number[] {
  const [a, b] = layer.range;
  return Array.from({ length: 6 }, (_, i) => a + ((b - a) * i) / 5);
}

export function buildLutBytes(layer: LayerDef): Uint8Array {
  const data = new Uint8Array(256 * 4);
  const [min, max] = layer.range;
  for (let i = 0; i < 256; i++) {
    const value = min + ((max - min) * i) / 255;
    const [r, g, b] = colorAt(layer.stops, value);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}
