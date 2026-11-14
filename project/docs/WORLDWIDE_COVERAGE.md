# MyWeather Pro — Worldwide Coverage and Reliability Contract

## Global-first objective

MyWeather is a worldwide weather application. Oman and Muscat are example
locations, never conditions for whether a feature works. Users should be able
to choose any real geographical point, including cities not present in local
autocomplete lists, rural regions, islands, vessels and polar locations. The
app now recognizes explicit decimal WGS84 coordinates in search, including
Arabic and Persian numeric digits, without relying on a geocoder request.

Every available feature should use data appropriate to the requested point.
World coverage does NOT imply that every weather, ocean, air quality or tide
source returns equally accurate data everywhere.

## Global acceptance rules

1. Location: preserve the user's saved cities, explicit primary choice,
   manually selected current city and last viewed place. A demo-city migration
   must never overwrite a real Prague, Tokyo, Johannesburg or other choice.
   Location permission is requested only for location-based actions.
2. Forecast: prefer geographically appropriate provider data and real
   forecast-valid times, not guessed temperatures or rain. Respect each
   provider's spatial and temporal availability.
3. Time and hemisphere: use the selected location's reported IANA time zone,
   daylight-saving changes and local solar day, never the device's time zone
   or a fixed Oman offset. Test southern seasons, UTC offsets and the
   antimeridian. A missing sunrise/sunset in polar night/day is valid.
4. Coastline and tides: ocean shoreline geography is separate from the
   numerical weather/ocean grid. Never treat proximity to a marine grid cell
   as proof a city is coastal. Inland users receive no marine tide card;
   island users are not second-class users. Natural Earth 1:10m is a
   cartographic approximation and cannot certify every small reef, port or
   estuary worldwide.
5. Source provenance: the current Open-Meteo Marine modeled total sea level
   has limited coastal accuracy. FES2022b/PyFES astronomical tides remain an
   isolated, OFF-by-default pilot until real licensed atlas cells are
   available worldwide, wet-cell selection and datum are verified, and
   independent station measurements validate performance.
6. AI: a learned tide residual must use only authentic past gauge records
   and archived meteorological forecasts issued BEFORE each predicted
   period. A model that does not beat real held-out benchmarks stays off.
   AI must not fabricate missing geographic coverage.
7. Device quality: conserve mobile data, battery and heap, handle slow or
   intermittent networks, cache source-backed results, and protect the
   privacy of precise location coordinates.

## Worldwide regression matrix

The continuous integration suite now covers:
- WGS84 coordinate search across the dateline (both +180 and -180),
  poles, southern latitudes and remote island locations.
- Arabic/Persian numeral entry and malformed/out-of-range locations.
- Ocean shoreline checks in the Arabian Peninsula, India, Northern Europe,
  Africa, Pacific islands, the Americas, Arctic and Southern Hemisphere,
  alongside inland controls on multiple continents.
- User-selected primary/saved city preservation and legacy demo migration.

The matrix is an engineering sample, not a certification that every coast
or every provider is perfectly covered. For a public worldwide release,
supplement it with real-device tests, global provider field-availability
telemetry collected with consent, station-grade ocean verification and
further localization. Preserve the approved existing UI/identity.

## Provider strategy

Global weather: provider-best-match based on the location and a source-backed
fallback, with coverage and quality checked per field.
Maps: real ECMWF and other forecast fields, pinned to their valid model cycle.
Marine: worldwide numerical source only where a valid ocean cell exists.
Tide forecast: physical FES2022b baseline on a future licensed service,
and only locally validated quality-corrected predictions where data allow.
Polar and inland locations: no invented ocean tides; the rest of the weather
app should remain fully usable.

Current status: source-backed global coordinates and regression protection
are implemented in the draft branch. Live worldwide tide-service deployment,
worldwide localized gauge calibration and globally uniform numerical
accuracy are NOT complete.
