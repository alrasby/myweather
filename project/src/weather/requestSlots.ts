/** FIFO concurrency budget for weather HTTP. Cancelling a queued request must
 * remove its listener and queue entry so rapid map pans cannot accumulate work.
 */
export class RequestSlots {
  private active = 0;
  private readonly waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    abort: () => void;
  }> = [];

  constructor(private readonly maxActive = 5, private readonly maxWaiting = 32) {}

  get running(): number { return this.active; }
  get queued(): number { return this.waiting.length; }

  acquire(signal?: AbortSignal): Promise<() => void> {
    const abortError = () => new DOMException("aborted", "AbortError");
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.maxActive) {
      this.active += 1;
      return Promise.resolve(this.releaseOnce());
    }
    if (this.waiting.length >= this.maxWaiting) {
      return Promise.reject(new Error("weather-request-queue-full"));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve, reject, signal,
        abort: () => {
          const i = this.waiting.indexOf(entry);
          if (i !== -1) this.waiting.splice(i, 1);
          signal?.removeEventListener("abort", entry.abort);
          reject(abortError());
        },
      };
      this.waiting.push(entry);
      signal?.addEventListener("abort", entry.abort, { once: true });
      if (signal?.aborted) entry.abort();
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.waiting.shift();
      if (!next) return;
      next.signal?.removeEventListener("abort", next.abort);
      if (next.signal?.aborted) {
        next.reject(new DOMException("aborted", "AbortError"));
        // Consume the next queued request; never leak capacity.
        this.drain();
      } else {
        this.active += 1;
        next.resolve(this.releaseOnce());
      }
    };
  }

  private drain(): void {
    while (this.active < this.maxActive && this.waiting.length) {
      const next = this.waiting.shift()!;
      next.signal?.removeEventListener("abort", next.abort);
      if (next.signal?.aborted) {
        next.reject(new DOMException("aborted", "AbortError"));
      } else {
        this.active += 1;
        next.resolve(this.releaseOnce());
      }
    }
  }
}

export function raceRequestTimeout<T>(
  work: Promise<T>, ms: number, signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clean = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const complete = (value: T) => {
      if (done) return;
      done = true;
      clean();
      resolve(value);
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      clean();
      reject(error);
    };
    const onAbort = () => fail(new DOMException("aborted", "AbortError"));
    // Always observe the underlying promise, even if the signal was already
    // aborted, to avoid unhandled native-plugin rejections after navigation.
    work.then(complete, fail);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => fail(new Error("proxy-timeout")), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}
