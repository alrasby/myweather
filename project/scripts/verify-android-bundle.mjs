/**
 * Prevent a green APK build from accidentally packaging a stale UI revision.
 * Run only AFTER: npm run build:android (Vite + Capacitor sync).
 */
import assert from "node:assert/strict";
import {existsSync,readdirSync,readFileSync,statSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {createHash} from "node:crypto";
const root=resolve(import.meta.dirname,"..");
const web=join(root,"www"),native=join(root,"android/app/src/main/assets/public");
const walk=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap(item=>{
 const name=join(dir,item.name);
 return item.isDirectory()?walk(name):item.isFile()?[name]:[];
});
for(const dir of [web,native])assert.ok(existsSync(join(dir,"index.html")),"missing Capacitor entry: "+dir);
const files=walk(web).filter(p=>/\.(js|css|html)$/.test(p));
assert.ok(files.length>=2,"missing web JS/CSS after Vite build");
const sum=p=>createHash("sha256").update(readFileSync(p)).digest("hex");
for(const path of files){
 const other=join(native,relative(web,path));
 assert.ok(existsSync(other),"Capacitor did not copy "+relative(web,path));
 assert.equal(statSync(other).size,statSync(path).size,"stale size: "+path);
 assert.equal(sum(other),sum(path),"stale native WebView resource: "+path);
}
const compiled=files.filter(p=>p.endsWith(".js")).map(p=>readFileSync(p,"utf8")).join("\n");
for(const symbol of ["Glass 3","wx-city-results","wx-setting-field-inline","Prague"]){
 assert.ok(compiled.includes(symbol),"expected build-60 UI/search marker not present in packaged JavaScript: "+symbol);
}
console.log("WebView assets match latest Vite build ("+files.length+" matching HTML/JS/CSS files); Glass 3 and live local-search code included.");
