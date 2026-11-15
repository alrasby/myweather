/** Tiny, transparent, bounded on-device online classifier for forecast-tile demand.
 * Six categorical decisions, five features and <=30 weights; no server calls,
 * location history, third-party ML runtime, storage or weather synthesis. */
export type TileAction = "east" | "west" | "north" | "south" | "nextHour" | "still";
export type TileSignals = {
  movingX: number; movingY: number; playing: boolean; slowNetwork?: boolean;
};
export const TILE_ACTIONS: readonly TileAction[] =
  ["east", "west", "north", "south", "nextHour", "still"] as const;
const FEATURES = 5;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function vector(s: TileSignals): number[] | null {
  if (!Number.isFinite(s.movingX) || !Number.isFinite(s.movingY)) return null;
  return [1, clamp(s.movingX, -1, 1), clamp(s.movingY, -1, 1),
    s.playing ? 1 : 0, s.slowNetwork ? 1 : 0];
}

export class TinyTileDemandModel {
  private readonly weights: number[][] = TILE_ACTIONS.map(() => Array(FEATURES).fill(0));
  private updates = 0;
  private tested = 0;
  private correct = 0;
  readonly maxWeights = TILE_ACTIONS.length * FEATURES;
  get observations(): number { return this.updates; }
  get accuracy(): number | null { return this.tested ? this.correct / this.tested : null; }

  private probabilities(features: readonly number[]): number[] {
    const logits = this.weights.map(row => row.reduce((sum, w, j) => sum + w * features[j]!, 0));
    const max = Math.max(...logits);
    const exps = logits.map(v => Math.exp(v - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(v => v / sum);
  }
  /** No prediction before 16 observations: deterministic prefetch remains default. */
  predict(s: TileSignals): TileAction | null {
    const f = vector(s);
    if (!f || this.updates < 16) return null;
    const p = this.probabilities(f);
    const sorted = [...p].sort((a, b) => b - a);
    const index = p.indexOf(sorted[0]!);
    // Abstain on low confidence or ties. "still" never increases background work.
    return sorted[0]! >= 0.55 && sorted[0]! - sorted[1]! >= 0.12
      ? TILE_ACTIONS[index]! : null;
  }
  /** One online softmax step, clipped bounded weights. Never trains on pixels. */
  observe(s: TileSignals, actual: TileAction): void {
    const f = vector(s), index = TILE_ACTIONS.indexOf(actual);
    if (!f || index < 0) return;
    const before = this.probabilities(f), winner = before.indexOf(Math.max(...before));
    if (this.updates >= 16) {
      this.tested = Math.min(1024, this.tested + 1);
      if (winner === index) this.correct = Math.min(1024, this.correct + 1);
    }
    const rate = 0.12 / Math.sqrt(1 + this.updates / 24);
    for (let k = 0; k < this.weights.length; k++) {
      const error = (k === index ? 1 : 0) - before[k]!;
      for (let j = 0; j < FEATURES; j++) {
        this.weights[k]![j] = clamp(this.weights[k]![j]! + rate * error * f[j]!, -3, 3);
      }
    }
    this.updates = Math.min(2048, this.updates + 1);
  }
  reset(): void {
    for (const row of this.weights) row.fill(0);
    this.updates = this.tested = this.correct = 0;
  }
}
