/** Bounded, device-local ECMWF performance samples. No location/URL data is
 * collected or transmitted. End-to-end tile timings include network, worker
 * transfer, decoding and painting; they must NOT be labelled "decode only".
 */
export type PerfSample = { count: number; meanMs: number; p95Ms: number; maxMs: number };
export type SpatialPerfKey = "network" | "nativeQueue" | "workerTile" | "leafletTile";
export type SpatialPerfSnapshot = Record<SpatialPerfKey, PerfSample>;
const KEYS: readonly SpatialPerfKey[] = ["network", "nativeQueue", "workerTile", "leafletTile"];
export class SpatialPerformance {
  private samples: Record<SpatialPerfKey, number[]> = {
    network: [], nativeQueue: [], workerTile: [], leafletTile: [],
  };
  private counts: Record<SpatialPerfKey, number> = {
    network: 0, nativeQueue: 0, workerTile: 0, leafletTile: 0,
  };
  private sums: Record<SpatialPerfKey, number> = {
    network: 0, nativeQueue: 0, workerTile: 0, leafletTile: 0,
  };
  constructor(private readonly capacity = 128) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("invalid sample capacity");
  }
  observe(key: SpatialPerfKey, elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
    this.counts[key]++;
    this.sums[key] += elapsedMs;
    const samples = this.samples[key];
    samples.push(elapsedMs);
    if (samples.length > this.capacity) samples.shift();
  }
  snapshot(): SpatialPerfSnapshot {
    return Object.fromEntries(KEYS.map((key) => {
      const sorted = [...this.samples[key]].sort((a, b) => a - b);
      const p95 = sorted[Math.max(0, Math.ceil(0.95 * sorted.length) - 1)] ?? 0;
      const count = this.counts[key];
      return [key, {
        count, meanMs: count ? Math.round(this.sums[key] / count) : 0,
        p95Ms: Math.round(p95), maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      }];
    })) as SpatialPerfSnapshot;
  }
}
