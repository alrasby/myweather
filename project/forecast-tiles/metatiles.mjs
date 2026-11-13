/** Geographic metatiling reuses exactly one decoded ECMWF window for
 * nearby 2x2 or 4x4 tiles. The actual pixel path remains source interpolation. */
import {tileBounds} from "./contracts.mjs";
export function metaTileBounds(r){
 const {x,y,z}=r;
 if (![x,y,z].every(Number.isInteger)||z<0||z>8||x<0||y<0||x>=2**z||y>=2**z)
   throw new Error("metatile-invalid");
 const n=2**z, group=z>=4?4:z>=2?2:1;
 const westX=Math.floor(x/group)*group, northY=Math.floor(y/group)*group;
 const eastX=Math.min(n-1,westX+group-1),southY=Math.min(n-1,northY+group-1);
 const a=tileBounds({z,x:westX,y:northY}),b=tileBounds({z,x:eastX,y:southY});
 const lonPad=(b.east-a.west)*.08,latPad=(a.north-b.south)*.08;
 return [Math.max(-180,a.west-lonPad),Math.max(-85.0511287798,b.south-latPad),
   Math.min(180,b.east+lonPad),Math.min(85.0511287798,a.north+latPad)];
}
