/** Standalone loopback-only producer; reverse proxy public /v1/ over HTTPS. */
import {createServer} from 'node:http';
import {resolve,sep,extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createTileGateway} from './gateway.mjs';
import {createBrowserProducer} from './producer.mjs';
const host='127.0.0.1',port=Number(process.env.TILE_PORT||8788);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('invalid-tile-port');
const origin='http://'+host+':'+port;
const dist=resolve(import.meta.dirname,'dist');
const cache=resolve(process.env.TILE_CACHE_DIR||'./.weather-tile-cache');
const producer=createBrowserProducer(origin);
const gateway=createTileGateway({renderTile:producer.renderTile,cacheDir:cache});
const server=createServer(async(req,res)=>{
 const path=(req.url||'').split('?')[0];
 if(!path.startsWith('/__render/')){gateway.server.emit('request',req,res);return;}
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 const remote=req.socket.remoteAddress;
 if(remote!=='127.0.0.1'&&remote!=='::1'&&remote!=='::ffff:127.0.0.1'){res.writeHead(403);res.end();return;}
 const target=resolve(dist,path.slice('/__render/'.length)||'index.html');
 if(!target.startsWith(dist+sep)){res.writeHead(403);res.end();return;}
 try{
  const data=await readFile(target);
  const ext=extname(target),type=ext==='.js'?'text/javascript':ext==='.wasm'?'application/wasm':ext==='.css'?'text/css':'text/html';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(data);
 }catch{res.writeHead(404);res.end();}
});
server.listen(port,host,()=>console.info('ECMWF ready-tile gateway listening on '+origin));
async function stop(){await producer.close();server.close();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
