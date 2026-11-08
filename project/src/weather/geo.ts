import { Capacitor } from "@capacitor/core";
type Fix = { lat: number; lon: number; accuracy: number };

function nativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function ensurePermission(): Promise<void> {
  if (!nativePlatform()) return;
  {
    const { Geolocation } = await import("@capacitor/geolocation");
    const perm = await Geolocation.checkPermissions();
    const granted =
      perm.location === "granted" || perm.coarseLocation === "granted";
    if (!granted) {
      const result = await Geolocation.requestPermissions();
      if (result.location !== "granted" && result.coarseLocation !== "granted")
        throw new Error("permission-denied");
    }
  }
}

async function readFix(
  high: boolean,
  timeout: number,
  maximumAge: number,
): Promise<Fix> {
  const work = (async () => {
    if (nativePlatform()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: high,
        timeout,
        maximumAge,
      });
      return {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? Infinity,
      };
    }
    if (!navigator.geolocation) throw new Error("no-geo");
    return new Promise<Fix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? Infinity,
          }),
        (err) => reject(err),
        { enableHighAccuracy: high, timeout, maximumAge },
      );
    });
  })();
  return withTimeout(work, timeout + 600);
}

/** قراءة شبكة سريعة ثم تصحيح GPS. onFix يُستدعى كلما تحسّنت الدقة، حتى اكتمال المحاولتين. */
export async function readBestPosition(
  onFix: (fix: Fix) => void,
): Promise<Fix | null> {
  await ensurePermission();
  let best: Fix | null = null;
  const take = (fix: Fix) => {
    if (!Number.isFinite(fix.accuracy) || fix.accuracy < 0) return;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
    if (Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return;
    if (best && fix.accuracy >= best.accuracy) return;
    best = fix;
    onFix(fix);
  };
  const coarse = readFix(false, 6000, 0).then(take);
  const fine = readFix(true, 18000, 0).then(take);
  await Promise.allSettled([coarse, fine]);
  return best;
}
