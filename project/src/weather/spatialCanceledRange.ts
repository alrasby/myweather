/**
 * A cancelled Leaflet viewport must NEVER receive an old ECMWF range.
 * Nevertheless, CapacitorHttp has no native abort once a request starts.
 * Safe completed immutable source bytes may warm the existing bounded
 * 512 KiB LRU, provided HTTP 206 Content-Range is exact.
 */
const PINNED_ECMWF_OM = /^https:\/\/openmeteo\.s3\.amazonaws\.com\/data_spatial\/ecmwf_ifs\/\d{4}\/\d{2}\/\d{2}\/\d{4}Z\/\d{4}-\d{2}-\d{2}T\d{4}\.om$/;
const CACHE_ITEM_BYTES = 512 * 1024;
type ByteRange = {start:number;end:number;length:number};
function byteRange(request:string|null|undefined):ByteRange|null {
  const match=/^bytes=(\d+)-(\d+)$/i.exec(request??"");
  if(!match)return null;
  const start=Number(match[1]),end=Number(match[2]);
  const length=end-start+1;
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&
    end>=start&&length>0&&length<=CACHE_ITEM_BYTES?{start,end,length}:null;
}
/** Only exact, immutable pinned ECMWF forecast files qualify. */
export function canRetainStartedEcmwfRange(
  url:string,method:string,requestRange:string|null|undefined,
):boolean {
  return method.toUpperCase()==="GET"&&PINNED_ECMWF_OM.test(url)&&
    byteRange(requestRange)!==null;
}
/** Never store a late cancelled response with mismatched requested bytes. */
export function certifiedAbortedEcmwfRange(
  url:string,method:string,requestRange:string|null|undefined,
  status:number,responseContentRange:string|null,receivedBytes:number,
):boolean {
  if(!canRetainStartedEcmwfRange(url,method,requestRange)||status!==206)return false;
  const wanted=byteRange(requestRange)!;
  if(receivedBytes!==wanted.length)return false;
  const match=/^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(responseContentRange??"");
  if(!match)return false;
  const start=Number(match[1]),end=Number(match[2]),size=Number(match[3]);
  return Number.isSafeInteger(size)&&size>0&&size>end&&
    start===wanted.start&&end===wanted.end;
}
