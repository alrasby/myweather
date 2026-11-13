/** Valid synthetic bitmap only for tests; never shipped as weather data. */
import {deflateSync} from "node:zlib";
import {pngCrc32} from "./pngIntegrity.mjs";
function chunk(name,data){
 const label=Buffer.from(name),header=Buffer.alloc(8),crc=Buffer.alloc(4);
 header.writeUInt32BE(data.length,0);label.copy(header,4);
 crc.writeUInt32BE(pngCrc32(Buffer.concat([label,data])),0);
 return Buffer.concat([header,data,crc]);
}
export function makeTestPng(){
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(256,0);ihdr.writeUInt32BE(256,4);ihdr[8]=8;ihdr[9]=6;
 const rows=Buffer.alloc(256*(1+4*256));
 return Buffer.concat([signature,chunk("IHDR",ihdr),chunk("IDAT",deflateSync(rows)),chunk("IEND",Buffer.alloc(0))]);
}
