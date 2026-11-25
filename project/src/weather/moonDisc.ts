/** Shadow of the unlit side. Phase 0 = new, 0.25 = first quarter (right lit), 0.5 = full, 0.75 = last quarter (left lit). */
export function shadowPath(phase: number): string {
  const p = ((phase % 1) + 1) % 1;
  if (Math.abs(p - 0.5) < 1e-8) return "";
  const r = 50;
  const k = Math.cos(p * Math.PI * 2);
  const samples = 48;
  const term: string[] = [];
  const limb: string[] = [];
  const darkOnRight = p > 0.5;
  for (let i = 0; i <= samples; i++) {
    const yy = 50 - r * Math.cos((Math.PI * i) / samples);
    const dy = yy - 50;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    const tx = 50 + (darkOnRight ? -k : k) * half;
    term.push(`${tx.toFixed(2)} ${yy.toFixed(2)}`);
    const reach = half;
    const lx = darkOnRight ? 50 + reach : 50 - reach;
    limb.push(`${lx.toFixed(2)} ${yy.toFixed(2)}`);
  }
  limb.reverse();
  return `M ${term.join(" L ")} L ${limb.join(" L ")} Z`;
}

