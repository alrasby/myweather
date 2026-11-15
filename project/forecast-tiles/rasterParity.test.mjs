import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {pngCrc32,validPng} from './pngIntegrity.mjs';
import {decodeRasterPng,eastWestSeam} from './rasterParity.mjs';
import {makeTestPng} from './testPng.mjs';
const N=256;
function chunk(name,data){
  const header=Buffer.alloc(8),crc=Buffer.alloc(4),label=Buffer.from(name);
  header.writeUInt32BE(data.length,0);label.copy(header,4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([label,data])),0);
  return Buffer.concat([header,data,crc]);
}
/** Produces QA-only known PNG scanlines with all five real PNG filters. */
function fixture(alpha,filter=0,channels=4){
  const rowLength=N*channels;
  const lines=Buffer.alloc(N*(rowLength+1));
  const desired=Buffer.alloc(rowLength);
  for(let x=0;x<N;x++){
    const at=x*channels;desired[at]=150;desired[at+1]=90;desired[at+2]=30;
    if(channels===4)desired[at+3]=alpha;
  }
  for(let y=0;y<N;y++){
    const offset=y*(rowLength+1);
    lines[offset]=filter;
    for(let i=0;i<rowLength;i++){
      const left=i>=channels?desired[i-channels]:0;
      const above=y>0?desired[i]:0;
      const upperLeft=y>0&&i>=channels?desired[i-channels]:0;
      let predictor=0;
      if(filter===1)predictor=left;
      else if(filter===2)predictor=above;
      else if(filter===3)predictor=Math.floor((left+above)/2);
      else if(filter===4){
        const p=left+above-upperLeft;
        const a=Math.abs(p-left),b=Math.abs(p-above),c=Math.abs(p-upperLeft);
        predictor=a<=b&&a<=c?left:b<=c?above:upperLeft;
      }
      lines[offset+1+i]=(desired[i]-predictor+256)&255;
    }
  }
  const ihdr=Buffer.alloc(13);
  ihdr.writeUInt32BE(N,0);ihdr.writeUInt32BE(N,4);ihdr[8]=8;ihdr[9]=channels===4?6:2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR',ihdr),chunk('IDAT',deflateSync(lines)),chunk('IEND',Buffer.alloc(0))]);
}
test('source-backed PNG decoder handles PNG filters 0–4 and RGB/RGBA',()=>{
  for(let filter=0;filter<=4;filter++){
    for(const channels of [3,4]){
      const image=fixture(117,filter,channels);
      assert.equal(validPng(image),true);
      const raw=decodeRasterPng(image);
      assert.equal(raw.length,256*256*4);
      for(const x of [0,1,127,255]){
        for(const y of [0,1,129,255]){
          const i=(y*256+x)*4;
          assert.deepEqual(Array.from(raw.subarray(i,i+4)),
            [150,90,30,channels===4?117:255]);
        }
      }
    }
  }
});
test('dry/cloudless transparent PNG is legitimate and is not falsely classified',()=>{
  const empty=makeTestPng();
  assert.equal(validPng(empty),true);
  const seam=eastWestSeam(empty,empty);
  assert.equal(seam.meanAlphaDelta,0);
  assert.equal(seam.suspiciousWall,false);
  assert.equal(seam.meanVisibleRgbDelta,null);
});
test('only pathological persistent sharp image boundary is reported as a probable seam',()=>{
  const clear=fixture(0),covered=fixture(255),nearby=fixture(247);
  assert.equal(eastWestSeam(clear,covered).suspiciousWall,true);
  assert.equal(eastWestSeam(covered,nearby).suspiciousWall,false);
  assert.equal(eastWestSeam(covered,nearby).meanAlphaDelta,8);
  assert.equal(eastWestSeam(covered,covered).meanVisibleRgbDelta,0);
});
test('corrupt PNG cannot masquerade as a valid continuous meteorological tile',()=>{
  const damaged=Buffer.from(fixture(200));
  damaged[damaged.length-10]^=1;
  assert.throws(()=>decodeRasterPng(damaged),/raster-parity-invalid-png/);
});
