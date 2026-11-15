/** Validate a complete 256px source-backed PNG, not just its magic bytes.
 * A broken or HTML error payload must never become an immutable forecast tile. */
import {inflateSync} from "node:zlib";
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CHUNK_LIMIT=2*1024*1024, TILE_SIZE=256;
const TABLE=Uint32Array.from({length:256},(_,value)=>{
 let c=value;
 for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;
 return c>>>0;
});
export function pngCrc32(data){
 let c=0xffffffff;
 for(const v of data)c=TABLE[(c^v)&255]^(c>>>8);
 return (c^0xffffffff)>>>0;
}
export function validPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<60||bytes.length>CHUNK_LIMIT||
   !bytes.subarray(0,8).equals(SIGNATURE))return false;
 let offset=8,header=false,hasData=false,done=false,pixelBytes=0;
 const images=[];
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset);
  if(length>CHUNK_LIMIT||offset+12+length>bytes.length)return false;
  const start=offset+8,end=start+length;
  const type=bytes.toString("ascii",offset+4,offset+8);
  if(pngCrc32(bytes.subarray(offset+4,end))!==bytes.readUInt32BE(end+0))return false;
  if(!header){
   if(type!=="IHDR"||length!==13||bytes.readUInt32BE(start)!==TILE_SIZE||
      bytes.readUInt32BE(start+4)!==TILE_SIZE||bytes[start+8]!==8||
      ![2,6].includes(bytes[start+9])||bytes[start+10]!==0||
      bytes[start+11]!==0||bytes[start+12]!==0)return false;
   header=true;pixelBytes=bytes[start+9]===6?4:3;
  }else if(type==="IDAT"){
   if(done)return false;
   hasData=true;images.push(bytes.subarray(start,end));
  }else if(type==="IEND"){
   if(!hasData||length!==0||end+4!==bytes.length)return false;
   done=true;
  }else if(type==="IHDR"||("ABCDEFGHIJKLMNOPQRSTUVWXYZ".includes(type[0])&&type[0]===type[0].toUpperCase())){
   // Reject unknown critical chunks: no unsupported image interpretation.
   if(type!=="PLTE")return false;
  }
  offset=end+4;
  if(done)break;
 }
 if(!header||!hasData||!done)return false;
 const stride=1+TILE_SIZE*pixelBytes,expected=stride*TILE_SIZE;
 try{
  const raw=inflateSync(Buffer.concat(images),{maxOutputLength:expected+1});
  if(raw.length!==expected)return false;
  for(let y=0;y<TILE_SIZE;y++)if(raw[y*stride]>4)return false;
  return true;
 }catch{return false;}
}
