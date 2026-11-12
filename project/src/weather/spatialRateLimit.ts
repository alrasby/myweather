/** Rate-limit guard for official ECMWF .om range requests.
 * A provider 429 must not be retried via the browser fallback immediately.
 * No background timers, additional concurrency, or fabricated image data.
 */
export class SpatialRateLimitError extends Error {
  readonly waitMs: number;
  constructor(waitMs: number) {
    super("spatial-provider-rate-limited");
    this.waitMs = waitMs;
    this.name = "SpatialRateLimitError";
  }
}

export function providerRetryMs(status: number, retryAfter: string | null, now = Date.now()): number {
  if (status !== 429 && status !== 503) return 0;
  // Transient 503 without Retry-After is handled by the existing fallback.
  if (status === 503 && !retryAfter) return 0;
  let delay = 30_000;
  if (retryAfter?.trim()) {
    const raw = retryAfter.trim();
    const seconds = /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
    const hinted = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
    if (Number.isFinite(hinted)) delay = hinted;
  }
  // Respect long Retry-After values up to one hour; never retry in a tight loop.
  return Math.max(5_000, Math.min(3_600_000, Math.ceil(delay)));
}

export class SpatialRateLimit {
  private until = 0;
  private hits = 0;
  get incidents(): number { return this.hits; }
  remainingMs(now = Date.now()): number { return Math.max(0, this.until - now); }
  observe(status: number, retryAfter: string | null, now = Date.now()): number {
    const delay = providerRetryMs(status, retryAfter, now);
    if (!delay) return 0;
    this.hits++;
    this.until = Math.max(this.until, now + delay);
    return delay;
  }
  assertAllowed(now = Date.now()): void {
    const wait = this.remainingMs(now);
    if (wait > 0) throw new SpatialRateLimitError(wait);
  }
}
