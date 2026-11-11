/** Preserve weather alert banners across refresh until explicitly dismissed. */
export function pinWeatherAlerts(previous: readonly string[], incoming: readonly string[]): string[] {
  if (!incoming.length) return previous.slice();
  const unique = Array.from(new Set([...previous, ...incoming]));
  return unique.slice(-10);
}
