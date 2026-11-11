/** Bounded, opt-in-readable performance probes for ECMWF only.
 * Network time and UI tile pipeline time are measured independently.
 * The OM library owns WASM decoding and Web Worker rendering; without
 * internal worker timings, tile pipeline cannot honestly be labeled decode. */
export type SpatialTimingStats = {
  count: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null;
};
export type SpatialPerformanceSnapshot = {
  nativeQueue: SpatialTimingStats;
  nativeNetwork: SpatialTimingStats;
  nativeFailures: number;
  nativeCancellations: number;
  nativeBytes: number;
  tilePipeline: SpatialTimingStats[];
  tileFailures: number[];
  runtime: { crossOriginIsolated: boolean; heapUsedMb: number | null };
};
export function summarizeDurations(samples: readonly number[]): SpatialTimingStats {
  const a = samples.filter((value) => Number.isFinite(value) && value >= 0).sort((x, y) => x - y);
  const quantile = (p: number) => a.length ? a[Math.ceil(a.length * p) - 1] : null;
  return { count: a.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), maxMs: a.at(-1) ?? null };
}
export class SpatialPerformance {
  private readonly queue: number[] = [];
  private readonly network: number[] = [];
  private readonly tiles: number[][] = [[], [], []];
  private readonly tileErrors: number[] = [0, 0, 0];
  private failures = 0;
  private cancellations = 0;
  private bytes = 0;
  private static readonly sampleLimit = 120;
  private add(samples: number[], value: number) {
    if (!Number.isFinite(value) || value < 0) return;
    samples.push(value);
    if (samples.length > SpatialPerformance.sampleLimit) samples.shift();
  }
  networkRequest(queueMs: number, networkMs: number, bytes: number, success: boolean, canceled = false) {
    this.add(this.queue, queueMs);
    this.add(this.network, networkMs);
    if (Number.isFinite(bytes) && bytes >= 0) this.bytes += bytes;
    if (canceled) this.cancellations++;
    else if (!success) this.failures++;
  }
  tile(index: number, ms: number, success: boolean) {
    if (index < 0 || index >= 3) return;
    if (success) this.add(this.tiles[index], ms);
    else this.tileErrors[index]++;
  }
  snapshot(crossOriginIsolated: boolean, heapBytes: number | null): SpatialPerformanceSnapshot {
    return {
      nativeQueue: summarizeDurations(this.queue),
      nativeNetwork: summarizeDurations(this.network),
      nativeFailures: this.failures,
      nativeCancellations: this.cancellations,
      nativeBytes: this.bytes,
      tilePipeline: this.tiles.map(summarizeDurations),
      tileFailures: [...this.tileErrors],
      runtime: {
        crossOriginIsolated,
        heapUsedMb: heapBytes == null || !Number.isFinite(heapBytes) ? null : Math.round(heapBytes / 1048576),
      },
    };
  }
}
