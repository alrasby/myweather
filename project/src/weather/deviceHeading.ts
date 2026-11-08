import { useEffect, useState } from "react";

type Orient = DeviceOrientationEvent & { webkitCompassHeading?: number; absolute?: boolean };

type CompassBridge = {
  start?: () => void;
  stop?: () => void;
};

declare global {
  interface Window {
    AndroidCompass?: CompassBridge;
    __wxHeading?: (deg: number) => void;
    __wxHome?: () => void;
  }
}

function norm(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function step(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return norm(from + delta * t);
}

/** اتجاه أعلى الهاتف: 0 = شمال. على أندرويد يأتي من مستشعر الدوران، وإلا من بوصلة المتصفح. */
export function useDeviceHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let shown: number | null = null;
    let goal: number | null = null;
    let raf = 0;

    const tick = () => {
      raf = 0;
      if (!alive || goal == null) return;
      const next = shown == null ? goal : step(shown, goal, 0.28);
      shown = next;
      setHeading(next);
      if (Math.abs(((goal - next + 540) % 360) - 180) > 0.35) raf = requestAnimationFrame(tick);
    };

    const aim = (deg: number) => {
      if (!alive || !Number.isFinite(deg)) return;
      goal = norm(deg);
      if (!raf) raf = requestAnimationFrame(tick);
    };

    window.__wxHeading = aim;
    const native = window.AndroidCompass;
    if (native?.start) native.start();

    const onOrient = (event: Event) => {
      if (native?.start) return;
      const e = event as Orient;
      let deg: number | null = null;
      if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) {
        deg = e.webkitCompassHeading;
      } else if ((e.absolute || event.type === "deviceorientationabsolute") && e.alpha != null && Number.isFinite(e.alpha)) {
        deg = 360 - e.alpha;
      }
      if (deg != null) aim(deg);
    };

    const ask = () => {
      const req = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
      if (!req) return;
      void req.call(DeviceOrientationEvent).catch(() => undefined);
    };

    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
    window.addEventListener("pointerdown", ask, { once: true });

    return () => {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      native?.stop?.();
      if (window.__wxHeading === aim) delete window.__wxHeading;
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      window.removeEventListener("deviceorientation", onOrient, true);
      window.removeEventListener("pointerdown", ask);
    };
  }, []);

  return heading;
}
