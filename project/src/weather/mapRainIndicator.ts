import type { FieldSample, Place, WeatherBundle } from "./types.ts";
export type RainReading = {amountMm:number|null; origin:"source-grid"|"point-forecast"|"missing"};
/**
 * A value is only a real precipitation rate when its SOURCE and valid time
 * match the display. Synthetic estimateGrid is never reported as observed or
 * forecast rain. ECMWF colourized raster tiles cannot be sampled as numeric
 * millimetres without decoded source values.
 */
export function mapRainReading(args:{
 sample:FieldSample|null;
 estimated:boolean;
 place:Place;
 point:WeatherBundle|null;
 center:{lat:number;lng:number}|null;
 displayedTimeMs:number;
}):RainReading {
 const {sample,estimated,place,point,center,displayedTimeMs}=args;
 if(!estimated&&sample&&Number.isFinite(sample.rain)&&sample.rain>=0)
   return {amountMm:sample.rain,origin:"source-grid"};
 if(!center||!point||!point.forecastSource||point.placeId!==place.id||
    !Number.isFinite(displayedTimeMs)||!point.hourly?.length)
   return {amountMm:null,origin:"missing"};
 const cos=Math.cos(place.lat*Math.PI/180);
 const distance=Math.hypot(center.lat-place.lat,(center.lng-place.lon)*cos);
 if(distance>2.2)return {amountMm:null,origin:"missing"};
 let bestMm:null|number=null;
 let delta=Infinity;
 for(const hourly of point.hourly){
  if(!Number.isFinite(hourly.t)||!Number.isFinite(hourly.precip)||hourly.precip<0)continue;
  const gap=Math.abs(hourly.t-displayedTimeMs);
  if(gap<delta){delta=gap;bestMm=hourly.precip;}
 }
 // Disallow a stale city value for a raster hour that is many hours ahead.
 if(bestMm===null||delta>90*60_000)return {amountMm:null,origin:"missing"};
 return {amountMm:bestMm,origin:"point-forecast"};
}
