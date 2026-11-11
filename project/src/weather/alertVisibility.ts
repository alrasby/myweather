/** Dismiss only the selected city's alerts after a deliberate pull refresh.
 * Ignore new incoming forecast warnings for this city until the next session;
 * the alert settings and other cities remain unaffected.
 */
export function suppressCityOnRefresh(previous: readonly string[], cityId: string): string[] {
  if (!cityId || previous.includes(cityId)) return previous.slice();
  return [...previous, cityId].slice(-32);
}

export function visibleWeatherNotices(
  notices: readonly string[],
  hiddenCityIds: readonly string[],
  cityId: string,
  manuallyDismissed: readonly string[],
): string[] {
  if (hiddenCityIds.includes(cityId)) return [];
  return notices.filter((notice) => !manuallyDismissed.includes(`${cityId}|${notice}`));
}
