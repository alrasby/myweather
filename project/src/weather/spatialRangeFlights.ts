/** Coalesce identical in-flight HTTP byte-range reads for ECMWF OM files.
 *
 * Completed ranges use SpatialRangeCache; this class fills the earlier gap:
 * many adjacent tiles request the same model-file blocks concurrently before
 * the first read completes. Every caller receives the same immutable result,
 * but may cancel independently. The shared read is cancelled only after the
 * final interested caller leaves; already-started native HTTP is still
 * non-abortable and its late result is ignored by the queue. */
export class SpatialRangeFlights<T> {
  private readonly flights = new Map<string, {
    controller: AbortController;
    promise: Promise<T>;
    users: number;
    settled: boolean;
  }>();
  private joins = 0;

  get joined(): number { return this.joins; }
  get active(): number { return this.flights.size; }

  run(key: string, callerSignal: AbortSignal | undefined, job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (callerSignal?.aborted) return Promise.reject(new Error("spatial-request-aborted"));
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const entry = {
        controller,
        users: 0,
        settled: false,
        promise: Promise.resolve().then(() => job(controller.signal)),
      };
      flight = entry;
      this.flights.set(key, entry);
      void entry.promise.then(
        () => { entry.settled = true; if (this.flights.get(key) === entry) this.flights.delete(key); },
        () => { entry.settled = true; if (this.flights.get(key) === entry) this.flights.delete(key); },
      );
    } else {
      this.joins++;
    }
    const active = flight;
    active.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const leave = () => {
        if (done) return false;
        done = true;
        callerSignal?.removeEventListener("abort", abort);
        active.users--;
        if (!active.settled && active.users === 0) {
          // No remaining consumer: stop queued native work and allow future
          // identical requests to start a fresh operation immediately.
          if (this.flights.get(key) === active) this.flights.delete(key);
          active.controller.abort();
        }
        return true;
      };
      const abort = () => {
        if (leave()) reject(new Error("spatial-request-aborted"));
      };
      callerSignal?.addEventListener("abort", abort, { once: true });
      if (callerSignal?.aborted) { abort(); return; }
      void active.promise.then(
        (value) => { if (leave()) resolve(value); },
        (error) => { if (leave()) reject(error); },
      );
    });
  }
}
