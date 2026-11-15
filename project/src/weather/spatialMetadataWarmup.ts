/** A single bounded, exact-source metadata request shared between Home's
 * idle map prewarm and the eventual ECMWF renderer. Never caches tiles or
 * weather values, never advances forecast clocks or persists old imagery. */
export const SPATIAL_METADATA_URL =
  "https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/latest.json";

export type SpatialMetadata = {
  reference_time?: string;
  valid_times?: string[];
  variables?: string[];
};

/** Injectable pure coalescer; failures expire immediately, success only
 * briefly. Callers must still validate run freshness and matching variables.
 */
export function createMetadataCache<T>(
  load: () => Promise<T>,
  now: () => number = Date.now,
  ttlMs = 45_000,
): () => Promise<T> {
  let latest: Promise<T> | null = null;
  let expiresAt = 0;
  return () => {
    if (latest && now() < expiresAt) return latest;
    const promise = Promise.resolve().then(load);
    latest = promise;
    expiresAt = now() + ttlMs;
    void promise.catch(() => {
      if (latest === promise) latest = null;
    });
    return promise;
  };
}

const load = async (): Promise<SpatialMetadata> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(SPATIAL_METADATA_URL, { signal: controller.signal });
    if (!response.ok) throw new Error("spatial-metadata-http-" + response.status);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("spatial-metadata-invalid");
    }
    return data as SpatialMetadata;
  } finally {
    clearTimeout(timeout);
  }
};

export const readSpatialMetadata = createMetadataCache(load);

/** Best effort: a failed idle prewarm must never trigger another retry loop. */
export function warmSpatialMetadata(): void {
  void readSpatialMetadata().catch(() => undefined);
}
