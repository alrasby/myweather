/** Short-lived byte-capped LRU for completed OM HTTP range responses.
 * Panning to previous areas otherwise repeats identical native range reads.
 * Store only verified 206 responses; keep latest-model cache lifetime short. */
export type CachedSpatialRange = { bytes: Uint8Array; headers: Record<string, string>; status: 206 };

export class SpatialRangeCache {
  private entries = new Map<string, { value: CachedSpatialRange; expires: number }>();
  private used = 0;
  constructor(
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly itemMaxBytes = 256 * 1024,
    private readonly ttlMs = 90_000,
  ) {}

  get(key: string, now = Date.now()): CachedSpatialRange | null {
    const item = this.entries.get(key);
    if (!item) return null;
    if (now >= item.expires) { this.delete(key); return null; }
    this.entries.delete(key);
    this.entries.set(key, item);
    return item.value;
  }

  put(key: string, value: CachedSpatialRange, now = Date.now()): void {
    const size = value.bytes.byteLength;
    if (!key || size === 0 || size > this.itemMaxBytes || size > this.maxBytes) return;
    this.delete(key);
    this.entries.set(key, { value: { ...value, bytes: value.bytes.slice(), headers: { ...value.headers } }, expires: now + this.ttlMs });
    this.used += size;
    while (this.used > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  private delete(key: string): void {
    const item = this.entries.get(key);
    if (!item) return;
    this.used -= item.value.bytes.byteLength;
    this.entries.delete(key);
  }
}
