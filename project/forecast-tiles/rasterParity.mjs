/** Read-only decoded PNG QA for SOURCE-BACKED ECMWF tiles.
 * No bitmap synthesis or weather-value alteration. Uses only Node core APIs;
 * returns border discontinuity metrics rather than assuming a clear sky is bad.
 */
import {inflateSync} from 'node:zlib';
import {validPng} from './pngIntegrity.mjs';

const SIZE=256;
export function decodeRasterPng(bytes){
  if(!validPng(bytes))throw new Error('raster-parity-invalid-png');
  let offset=8, channels=0;
  const chunks=[];
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset);
    const type=bytes.toString('ascii',offset+4,offset+8);
    if(type==='IHDR')channels=bytes[offset+8+9]===6?4:3;
    if(type==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+length));
    offset+=12+length;
    if(type==='IEND')break;
  }
  const rowBytes=SIZE*channels,stride=rowBytes+1;
  const raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:SIZE*stride+1});
  const pixels=new Uint8Array(SIZE*SIZE*4);
  let previous=new Uint8Array(rowBytes);
  for(let y=0;y<SIZE;y++){
    const filter=raw[y*stride];
    const row=new Uint8Array(rowBytes);
    for(let i=0;i<rowBytes;i++){
      const source=raw[y*stride+1+i];
      const left=i>=channels?row[i-channels]:0;
      const above=previous[i];
      const upperLeft=i>=channels?previous[i-channels]:0;
      let predictor=0;
      if(filter===1)predictor=left;
      else if(filter===2)predictor=above;
      else if(filter===3)predictor=Math.floor((left+above)/2);
      else if(filter===4){
        const p=left+above-upperLeft;
        const a=Math.abs(p-left),b=Math.abs(p-above),c=Math.abs(p-upperLeft);
        predictor=a<=b&&a<=c?left:b<=c?above:upperLeft;
      }
      row[i]=(source+predictor)&255;
    }
    for(let x=0;x<SIZE;x++){
      const inOffset=x*channels, outOffset=(y*SIZE+x)*4;
      pixels[outOffset]=row[inOffset];
      pixels[outOffset+1]=row[inOffset+1];
      pixels[outOffset+2]=row[inOffset+2];
      pixels[outOffset+3]=channels===4?row[inOffset+3]:255;
    }
    previous=row;
  }
  return pixels;
}
/** The two neighboring last/first pixel columns should not have a persistent
 * opaque/transparent vertical wall. This is a conservative diagnostic, NOT a
 * proof of forecast correctness or a strict pixel-equality expectation.
 * E/W adjacency includes x=2^z-1 to x=0 across the dateline.
 */
export function eastWestSeam(westPng,eastPng){
  const west=decodeRasterPng(westPng),east=decodeRasterPng(eastPng);
  let sumAlpha=0,strong=0,colorSum=0,colorCount=0;
  for(let y=0;y<SIZE;y++){
    const a=(y*SIZE+SIZE-1)*4,b=(y*SIZE)*4;
    const diff=Math.abs(west[a+3]-east[b+3]);
    sumAlpha+=diff;
    if(diff>96)strong++;
    if(west[a+3]>16&&east[b+3]>16){
      colorSum+=(Math.abs(west[a]-east[b])+
        Math.abs(west[a+1]-east[b+1])+Math.abs(west[a+2]-east[b+2]))/3;
      colorCount++;
    }
  }
  const meanAlphaDelta=Number((sumAlpha/SIZE).toFixed(2));
  const strongAlphaFraction=Number((strong/SIZE).toFixed(4));
  return {
    meanAlphaDelta,strongAlphaFraction,
    meanVisibleRgbDelta:colorCount?Number((colorSum/colorCount).toFixed(2)):null,
    comparedRows:SIZE,
    suspiciousWall:meanAlphaDelta>140&&strongAlphaFraction>0.9,
  };
}
