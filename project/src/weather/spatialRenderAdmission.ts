/** Bounded, abortable admission for the Android ECMWF raster-worker queue.
 *
 * Old implementation immediately switched a tile to the legacy renderer when
 * 40 worker jobs were queued. During fast pans this produced two rendering
 * backends and expensive duplicate work in the same viewport. Admission
 * now back-pressures the callers for a bounded interval without allocating
 * raster buffers. Aborted Leaflet requests leave the queue immediately. */
export type AdmissionFailure = "saturated" | "deadline" | "closed";
export class SpatialAdmissionError extends Error {
  readonly reason: AdmissionFailure;
  constructor(reason: AdmissionFailure) {
    super(`spatial-worker-admission-${reason}`);
    this.reason = reason;
    this.name = "SpatialAdmissionError";
  }
}
type Waiter = { signal: AbortSignal; resolve: (release: () => void) => void;
  reject: (error: Error) => void; cleanup: () => void };

export class SpatialRenderAdmission {
  private inUse = 0;
  private waiters: Waiter[] = [];
  private closed = false;
  private peak = 0;
  private readonly capacity: number;
  private readonly maxWaiting: number;
  private readonly deadlineMs: number;
  constructor(capacity = 40, maxWaiting = 64, deadlineMs = 15_000) {
    if (capacity < 1 || maxWaiting < 0 || deadlineMs < 1)
      throw new Error("invalid-spatial-render-admission");
    this.capacity = capacity;
    this.maxWaiting = maxWaiting;
    this.deadlineMs = deadlineMs;
  }

  get waiting(): number { return this.waiters.length; }
  get active(): number { return this.inUse; }
  get peakWaiting(): number { return this.peak; }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (this.closed) return Promise.reject(new SpatialAdmissionError("closed"));
    if (this.inUse < this.capacity && this.waiters.length === 0) {
      this.inUse++;
      return Promise.resolve(this.releaseToken());
    }
    if (this.waiters.length >= this.maxWaiting)
      return Promise.reject(new SpatialAdmissionError("saturated"));
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const remove = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal.removeEventListener("abort", onAbort);
        clearTimeout(timer);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        remove();
        reject(error);
      };
      const onAbort = () => fail(new DOMException("Aborted", "AbortError"));
      const waiter: Waiter = {
        signal,
        resolve: (token) => { if (settled) { token(); return; } settled = true; remove(); resolve(token); },
        reject: fail,
        cleanup: remove,
      };
      signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => fail(new SpatialAdmissionError("deadline")), this.deadlineMs);
      this.waiters.push(waiter);
      this.peak = Math.max(this.peak, this.waiters.length);
    });
  }

  private releaseToken(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse = Math.max(0, this.inUse - 1);
      while (!this.closed && this.inUse < this.capacity && this.waiters.length) {
        const waiter = this.waiters[0]!;
        if (waiter.signal.aborted) {
          waiter.reject(new DOMException("Aborted", "AbortError"));
          continue;
        }
        this.inUse++;
        waiter.resolve(this.releaseToken());
      }
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of [...this.waiters]) waiter.reject(new SpatialAdmissionError("closed"));
    this.waiters = [];
  }
}
