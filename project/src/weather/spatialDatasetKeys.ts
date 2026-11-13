/** Stable data identity for ECMWF worker raster caches.
 * A request-scoped shallow state snapshot must not cause a new 25MiB clone
 * when it points at the same immutable data array and geographic layout. */
import type {OmUrlState} from "@openmeteo/weather-map-layer";

type Palette={breakpoints:number[]; colors:number[][]};

export class SpatialDatasetKeys {
 private readonly entries=new WeakMap<object,Map<string,string>>();
 private next=0;
 key(state:OmUrlState,palette:Palette):string {
  const data=state.data;
  const values=data?.values;
  if(!values)throw new Error("spatial-data-identity-missing");
  // Both identity AND interpretation must match. In particular, a changed
  // geographic window cannot be reused just because its hour is unchanged.
  const shape=JSON.stringify([
   state.omFileUrl,state.dataOptions.variable,
   state.dataOptions.deltaTimeHours??null,
   state.dataOptions.domain.value,state.dataOptions.domain.grid,
   state.ranges,data?.scaleFactor??null,
   values.byteOffset,values.byteLength,
   palette.breakpoints,palette.colors,
  ]);
  let scopes=this.entries.get(values);
  if(!scopes){scopes=new Map();this.entries.set(values,scopes);}
  let id=scopes.get(shape);
  if(!id){id="decoded-"+(++this.next);scopes.set(shape,id);}
  return id;
 }
}
