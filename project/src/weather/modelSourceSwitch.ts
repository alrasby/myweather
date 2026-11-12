/** ECMWF frames and Open-Meteo point-grid fallback are different raster products.
 * Never alpha-composite them into one weather map: this creates geometric
 * rectangles and falsely mixes clouds/precipitation from different runs. */
export function chooseWeatherSource(
  currentModelReady: boolean,
  realFallbackReady: boolean,
  previouslyOnFallback: boolean,
): { fallback: boolean; snapCompleteModel: boolean } {
  const fallback = realFallbackReady && !currentModelReady;
  return { fallback, snapCompleteModel: previouslyOnFallback && currentModelReady };
}
