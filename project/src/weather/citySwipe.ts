/** Resolve a deliberate horizontal home-page swipe against saved places only.
 * RTL: swipe right -> next; LTR: swipe left -> next. No wrap at boundaries.
 * A preview/unsaved location never becomes saved from a gesture.
 */
export function citySwipeTarget(
  savedIds: readonly string[],
  activeId: string,
  deltaX: number,
  deltaY: number,
  rtl: boolean,
): string | null {
  if (savedIds.length < 2 || !Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
  if (Math.abs(deltaX) < 68 || Math.abs(deltaX) < Math.abs(deltaY) * 1.45) return null;
  const current = savedIds.indexOf(activeId);
  if (current < 0) return null;
  const step = (deltaX > 0 ? 1 : -1) * (rtl ? 1 : -1);
  return savedIds[current + step] ?? null;
}
