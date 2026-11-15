/**
 * Mandatory independent physical-Android release gate.
 * Node fixtures exercise the validator only; never constitute device results.
 * Run: node scripts/device-qa-evidence.mjs path/to/device-evidence.json
 */
import {readFileSync} from "node:fs";
import {pathToFileURL} from "node:url";
const budgets={
 low:{ramMin:2,ramMax:4,uiP95:160,coldStart:5500},
 mid:{ramMin:4,ramMax:8,uiP95:100,coldStart:3500},
};
const flags=["rtlArPass","ltrEnPass","textScale200Pass","touchPass",
 "screenReaderPass","reducedMotionPass","unitsPass","timeZonePass",
 "sourceAttributionPass","noClippingPass","noBlackMapGapsPass"];
const finite=n=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
export function validateDeviceEvidence(evidence) {
 const errors=[];
 if(!evidence||!Array.isArray(evidence.runs))return {ok:false,errors:["missing physical Android device runs"]};
 for(const tier of ["low","mid"]) {
  const matches=evidence.runs.filter(r=>r?.tier===tier);
  if(matches.length!==1){errors.push(tier+": expected exactly one measured run");continue;}
  const r=matches[0], b=budgets[tier];
  if(r.source!=="physical-android" || typeof r.device!=="string" || !r.device.trim()) errors.push(tier+": physical device identity required");
  if(!Number.isFinite(Date.parse(r.testedAt))||typeof r.testedAt!=="string")errors.push(tier+": test time required");
  if(!finite(r.ramGiB)||r.ramGiB<b.ramMin||r.ramGiB>b.ramMax)errors.push(tier+": wrong RAM class");
  if(!finite(r.uiInteractionP95Ms)||r.uiInteractionP95Ms>b.uiP95)errors.push(tier+": UI p95 budget exceeded/missing");
  if(!finite(r.coldStartMs)||r.coldStartMs>b.coldStart)errors.push(tier+": cold-start budget exceeded/missing");
  for(const field of ["jsHeapGrowthMiB","nativePssGrowthMiB"]) {
    if(!finite(r[field]))errors.push(tier+": "+field+" missing");
  }
  // Conservative proposed drift budgets after 20 repeated navigation/city cycles.
  if(finite(r.jsHeapGrowthMiB)&&r.jsHeapGrowthMiB>32)errors.push(tier+": sustained JS heap growth");
  if(finite(r.nativePssGrowthMiB)&&r.nativePssGrowthMiB>96)errors.push(tier+": sustained native PSS growth");
  if(!finite(r.crashes)||r.crashes!==0)errors.push(tier+": crashes");
  if(!finite(r.mapFirstFrameP95Ms))errors.push(tier+": ECMWF timing missing (record but no unproven universal threshold)");
  for(const flag of flags)if(r[flag]!==true)errors.push(tier+": "+flag+" missing/fail");
 }
 return {ok:errors.length===0,errors};
}
const argv=process.argv[1];
if(argv&&import.meta.url===pathToFileURL(argv).href){
 if(process.argv.length!==3){console.error("Usage: node scripts/device-qa-evidence.mjs DEVICE_EVIDENCE.json");process.exitCode=2;}
 else {
  try {
   const result=validateDeviceEvidence(JSON.parse(readFileSync(process.argv[2],"utf8")));
   console.log(JSON.stringify(result,null,2));
   if(!result.ok)process.exitCode=1;
  }catch(e){console.error(String(e));process.exitCode=2;}
 }
}
