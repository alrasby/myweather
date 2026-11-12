/** Server-side SSRF guard for the weather data proxy.
 * Pin upstream hosts, HTTPS, standard port and bounded query length.
 * Redirects are disabled by the caller to avoid redirect-to-private-network.
 */
const WEATHER_HOSTS = new Set([
  "api.open-meteo.com", "air-quality-api.open-meteo.com",
  "geocoding-api.open-meteo.com", "marine-api.open-meteo.com",
  "www.gdacs.org", "www.nhc.noaa.gov", "www.metoc.navy.mil",
  "tgftp.nws.noaa.gov", "api.met.no",
]);

export function validatedWeatherProxyUrl(input: unknown): string {
  if (typeof input !== "string" || input.length > 3072 || input.length < 12) {
    throw new Error("invalid-weather-url");
  }
  const url = new URL(input);
  if (url.protocol !== "https:" || !WEATHER_HOSTS.has(url.hostname) ||
    url.username || url.password || url.port || url.hash ||
    url.pathname.length > 1600 || url.search.length > 2000) {
    throw new Error("untrusted-weather-host");
  }
  return url.toString();
}
