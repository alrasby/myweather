type Fix = { lat: number; lon: number; accuracy: number };

function nativePlatform(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
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
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const perm = await Geolocation.checkPermissions();
    const granted = perm.location === "granted" || perm.coarseLocation === "granted";
    if (!granted) await Geolocation.requestPermissions();
  } catch {
    /* المتصفح يطلب الإذن من getCurrentPosition */
  }
}

async function readFix(high: boolean, timeout: number, maximumAge: number): Promise<Fix> {
  const work = (async () => {
    if (nativePlatform()) {
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: high, timeout, maximumAge });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy ?? (high ? 25 : 1500) };
    }
    if (!navigator.geolocation) throw new Error("no-geo");
    return new Promise<Fix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy ?? (high ? 25 : 1500) }),
        (err) => reject(err),
        { enableHighAccuracy: high, timeout, maximumAge },
      );
    });
  })();
  return withTimeout(work, timeout + 600);
}

/** قراءة شبكة سريعة ثم تصحيح GPS. onFix يُستدعى كلما تحسّنت الدقة، حتى بعد أول نتيجة. */
export async function readBestPosition(onFix: (fix: Fix) => void): Promise<Fix | null> {
  await ensurePermission();
  let best: Fix | null = null;
  const take = (fix: Fix) => {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
    if (Math.abs(fix.lat) > 90 || Math.abs(fix.lon) > 180) return;
    if (best && fix.accuracy >= best.accuracy - 15) return;
    best = fix;
    onFix(fix);
  };
  const coarse = readFix(false, 2800, 8_000).then(take).catch(() => undefined);
  const fine = readFix(true, 12000, 0).then(take).catch(() => undefined);
  await Promise.race([
    fine,
    (async () => {
      await coarse;
      const acc = best ? (best as Fix).accuracy : 99999;
      await new Promise((resolve) => window.setTimeout(resolve, acc <= 60 ? 900 : 2800));
    })(),
  ]);
  await Promise.race([fine, new Promise((resolve) => window.setTimeout(resolve, 250))]);
  return best;
}
