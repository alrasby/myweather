/** Limits concurrent non-abortable CapacitorHttp requests. The Leaflet/OM
 * protocol may cancel a frame while native HTTP is already running, but
 * CapacitorHttp.request has no AbortSignal API. Pending requests therefore
 * must be skipped before they enter native transport. */
export class SpatialNativeQueue {
  private active = 0;
  private waiters: Array<{
    signal: AbortSignal | undefined;
    releaseAbort: () => void;
    resolve: () => void;
    reject: (reason: Error) => void;
  }> = [];

  private readonly limit: number;
  constructor(limit = 4) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("invalid concurrency limit");
    this.limit = limit;
  }

  private abortError(): Error {
    return new Error("spatial-request-aborted");
  }

  async run<T>(signal: AbortSignal | undefined, job: () => Promise<T>): Promise<T> {
    if (signal?.aborted) throw this.abortError();
    if (this.active < this.limit && this.waiters.length === 0) {
      this.active++;
    } else {
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          signal,
          releaseAbort: () => {},
          resolve: () => resolve(),
          reject: (reason: Error) => reject(reason),
        };
        const onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          waiter.releaseAbort();
          reject(this.abortError());
        };
        waiter.releaseAbort = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, { once: true });
        this.waiters.push(waiter);
      });
    }
    try {
      if (signal?.aborted) throw this.abortError();
      const result = await job();
      if (signal?.aborted) throw this.abortError();
      return result;
    } finally {
      this.active--;
      while (this.waiters.length) {
        const waiter = this.waiters.shift()!;
        waiter.releaseAbort();
        if (waiter.signal?.aborted) {
          waiter.reject(this.abortError());
          continue;
        }
        this.active++;
        waiter.resolve();
        break;
      }
    }
  }
}
