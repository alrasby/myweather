/** Mathematical unit conversions; no rounding until UI rendering.
 * Inputs: °C, km/h, hPa, metres. Never change weather-source values in storage. */
import type {TempUnit, WindUnit, PressureUnit, DistanceUnit} from "./types";
export const convertTemp=(c:number,unit:TempUnit):number=>
  unit==="f"?(c*9)/5+32:c;
export function convertWind(kmh:number,unit:WindUnit):number {
  if(unit==="ms")return kmh/3.6;
  if(unit==="mph")return kmh*0.621371;
  if(unit==="kn")return kmh*0.539957;
  return kmh;
}
export const convertPressure=(hpa:number,unit:PressureUnit):number=>
  unit==="inhg"?hpa/33.8638866667:hpa;
export const convertDistance=(metres:number,unit:DistanceUnit):number=>
  (metres/1000)*(unit==="mi"?0.621371:1);
