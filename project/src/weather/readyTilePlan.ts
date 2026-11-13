/** Bounded predictive tile-demand scheduling; never invents forecast data. */
export type PrefetchPoint={z:number;x:number;y:number;hour:number;layer:'cloud_cover'|'precipitation'|'snowfall_water_equivalent'};
export type PrefetchInput={z:number;x:number;y:number;hour:number;count:number;movingX:number;movingY:number;playing:boolean;dataSaver:boolean};
export function planReadyTilePrefetch(p:PrefetchInput):PrefetchPoint[]{
 if(![p.z,p.x,p.y,p.hour,p.count,p.movingX,p.movingY].every(Number.isFinite)||
    !Number.isInteger(p.z)||p.z<0||p.z>8||!Number.isInteger(p.hour)||p.hour<0||
    !Number.isInteger(p.count)||p.count<1)return [];
 const n=2**p.z,x=Math.floor(p.x),y=Math.floor(p.y),dx=Math.sign(p.movingX),dy=Math.sign(p.movingY);
 const positions:Array<[number,number]>=[[0,0],[dx,dy],[dx,0],[0,dy],[1,0],[-1,0],[0,1],[0,-1]];
 const layers:PrefetchPoint['layer'][]=['cloud_cover','precipitation','snowfall_water_equivalent'];
 const hour=p.playing&&p.hour+1<p.count?p.hour+1:p.hour;
 const budget=p.dataSaver?0:p.playing?8:4;
 if(!budget)return [];
 const out:PrefetchPoint[]=[],seen=new Set<string>();
 for(const [px,py] of positions)for(const layer of layers){
  const xx=((x+px)%n+n)%n,yy=y+py;
  if(yy<0||yy>=n)continue;
  const key=hour+'/'+layer+'/'+xx+'/'+yy;
  if(seen.has(key))continue;
  seen.add(key);out.push({z:p.z,x:xx,y:yy,hour,layer});
  if(out.length>=budget)return out;
 }
 return out;
}
