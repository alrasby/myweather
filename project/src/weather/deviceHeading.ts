import { useEffect, useState } from "react";

type Orient = DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean };
type CompassBridge = {
  start?: () => void;
  stop?: () => void;
  setLocation?: (lat: number, lon: number) => void;
};
export type CompassReading = {
  heading: number | null;
  accuracy: "high" | "medium" | "low" | "unknown";
  trueNorth: boolean;
};

declare global {
  interface Window {
    AndroidCompass?: CompassBridge;
    __wxHeading?: (deg: number) => void;
    __wxHeadingMeta?: (deg: number, accuracy: number, trueNorth: boolean) => void;
    __wxHome?: () => void;
  }
}

const normalize = (deg: number) => ((deg % 360) + 360) % 360;
function step(from: number, to: number, t: number) {
  const delta = ((to - from + 540) % 360) - 180;
  return normalize(from + delta * t);
}

export function useDeviceCompass(lat: number, lon: number): CompassReading {
  const [reading, setReading] = useState<CompassReading>({ heading: null, accuracy: "unknown", trueNorth: false });

  useEffect(() => {
    window.AndroidCompass?.setLocation?.(lat, lon);
  }, [lat, lon]);

  useEffect(() => {
    let alive = true;
    let shown: number | null = null;
    let goal: number | null = null;
    let raf = 0;
    let lastOutput: CompassReading = { heading: null, accuracy: "unknown", trueNorth: false };
    const tick = () => {
      raf = 0;
      if (!alive || goal == null) return;
      shown = shown == null ? goal : step(shown, goal, 0.28);
      const next = { ...lastOutput, heading: shown };
      setReading(next);
      if (Math.abs(((goal - shown + 540) % 360) - 180) > 0.35) raf = requestAnimationFrame(tick);
    };
    const aim = (deg: number, accuracy: CompassReading["accuracy"], trueNorth: boolean) => {
      if (!alive || !Number.isFinite(deg)) return;
      lastOutput = { heading: lastOutput.heading, accuracy, trueNorth };
      goal = normalize(deg);
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const native = window.AndroidCompass;
    const meta = (deg: number, accuracy: number, trueNorth: boolean) =>
      aim(deg, accuracy >= 3 ? "high" : accuracy === 2 ? "medium" : accuracy >= 0 ? "low" : "unknown", trueNorth);
    const legacy = (deg: number) => aim(deg, "unknown", false);
    window.__wxHeadingMeta = meta;
    window.__wxHeading = legacy;
    native?.start?.();

    const onOrient = (event: Event) => {
      if (native?.start) return;
      const e = event as Orient;
      if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) {
        aim(e.webkitCompassHeading, "unknown", false);
      } else if ((e.absolute || event.type === "deviceorientationabsolute") && e.alpha != null && Number.isFinite(e.alpha)) {
        aim(360 - e.alpha, "unknown", false);
      }
    };
    const ask = () => {
      if (typeof DeviceOrientationEvent === "undefined") return;
      const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
      if (req) void req.call(DeviceOrientationEvent).catch(() => undefined);
    };
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
    window.addEventListener("pointerdown", ask, { once: true });
    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      native?.stop?.();
      if (window.__wxHeadingMeta === meta) delete window.__wxHeadingMeta;
      if (window.__wxHeading === legacy) delete window.__wxHeading;
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      window.removeEventListener("deviceorientation", onOrient, true);
      window.removeEventListener("pointerdown", ask);
    };
  }, []);

  return reading;
}

/** Compatibility hook for callers that need a heading only. */
export function useDeviceHeading(): number | null {
  return useDeviceCompass(Number.NaN, Number.NaN).heading;
}
