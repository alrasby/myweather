/** Viewport-coherent ECMWF render generation.
 * Three model layers may finish at different times; a completed cloud layer
 * from an old viewport is NOT proof that rain/snow for a new view are done.
 * This barrier tracks each layer's last "loading" generation and disregards
 * late "load" from a superseded gesture, without fabricating map pixels. */
export class SpatialRenderGeneration {
  private epoch = 0;
  private started = new Set<number>();
  private finished = new Set<number>();
  get id(): number { return this.epoch; }
  begin(): number {
    this.epoch++;
    this.started.clear();
    this.finished.clear();
    return this.epoch;
  }
  loading(index: number): number {
    this.started.add(index);
    this.finished.delete(index);
    return this.epoch;
  }
  accepts(epoch: number): boolean { return epoch === this.epoch; }
  loaded(index: number, epoch: number): boolean {
    if (!this.accepts(epoch) || !this.started.has(index)) return false;
    this.finished.add(index);
    return true;
  }
  ready(): boolean {
    if (!this.started.size) return false;
    for (const i of this.started) if (!this.finished.has(i)) return false;
    return true;
  }
  get pending(): number { return this.started.size - this.finished.size; }
}
