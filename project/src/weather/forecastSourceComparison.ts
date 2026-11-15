/** Source/time provenance for opt-in ECMWF vs city-forecast diagnostics.
 * A city WMO code is point-based; ECMWF is an area cloud raster. This helper
 * never infers an on-the-ground condition from a map colour or invents data. */
export type CityForecastPoint = {
  placeId:string;
  timezone:string;
  fetchedAt:number;
  forecastSource?:"open-meteo-best-match"|"met-no";
  current:{t:number;code:number;cloud:number};
};
export type PointSpatialComparison = {
  pointProvider:"open-meteo-best-match"|"met-no"|"unknown-cached-provider";
  pointValidTime:string|null;
  pointFetchedAt:string|null;
  pointWmoCode:number|null;
  pointCloudCoverPct:number|null;
  mapEcmwfValidTime:string|null;
  absoluteTimeGapMinutes:number|null;
  sameForecastHour:boolean;
  comparisonScope:"same-hour-different-models"|"different-forecast-hours"|"time-unavailable";
};
const iso=(ms:number)=>{
  if(!Number.isFinite(ms))return null;
  const date=new Date(ms);
  return Number.isFinite(date.getTime())?date.toISOString():null;
};
export function comparePointWithSpatial(
  point:CityForecastPoint|null|undefined,
  ecmwfValidTime:string|null|undefined,
):PointSpatialComparison|null {
  if(!point)return null;
  const pointTime=iso(point.current?.t);
  const mapMs=typeof ecmwfValidTime==="string"&&ecmwfValidTime
    ? Date.parse(ecmwfValidTime):NaN;
  const mapTime=iso(mapMs);
  const gap=pointTime&&mapTime?Math.round(Math.abs(point.current.t-mapMs)/60000):null;
  // A 16:59 point and a 17:01 map are 2 minutes apart but NOT the same UTC hour.
  // Never infer source-hour equality from a 60-minute tolerance.
  const sameForecastHour=gap!==null&&
    Math.floor(point.current.t/3_600_000)===Math.floor(mapMs/3_600_000);
  const code=point.current?.code;
  const cover=point.current?.cloud;
  return {
    pointProvider:point.forecastSource??"unknown-cached-provider",
    pointValidTime:pointTime,
    pointFetchedAt:iso(point.fetchedAt),
    pointWmoCode:Number.isInteger(code)&&code>=0&&code<=99?code:null,
    pointCloudCoverPct:Number.isFinite(cover)&&cover>=0&&cover<=100?cover:null,
    mapEcmwfValidTime:mapTime,
    absoluteTimeGapMinutes:gap,
    sameForecastHour,
    comparisonScope:gap===null?"time-unavailable":sameForecastHour?
      "same-hour-different-models":"different-forecast-hours",
  };
}
