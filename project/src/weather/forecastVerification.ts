/**
 * Point-forecast verification foundation for QA, not a claim of WMO
 * accreditation. Feed INDEPENDENT, observed values with exact UTC valid time.
 * Reject mismatched variables, units, providers or forecast hours rather than
 * reporting artificially favorable scores.
 */
export type ContinuousVerificationPair = Readonly<{
  variable: string;
  unit: string;
  forecastProvider: string;
  observationProvider: string;
  forecastValidTimeMs: number;
  observedTimeMs: number;
  forecast: number;
  observed: number;
}>;
export type ProbabilityVerificationPair = Omit<
  ContinuousVerificationPair, "forecast" | "observed"
> & Readonly<{ probability: number; occurred: boolean }>;

export type ContinuousVerificationScore = Readonly<{
  samples: number;
  excluded: number;
  bias: number | null;
  mae: number | null;
  rmse: number | null;
}>;
export type ProbabilityVerificationScore = Readonly<{
  samples: number;
  excluded: number;
  brierScore: number | null;
}>;

function matched(
  item: Pick<ContinuousVerificationPair, "variable" | "unit" |
    "forecastProvider" | "observationProvider" |
    "forecastValidTimeMs" | "observedTimeMs">,
  variable: string, unit: string, toleranceMs: number,
): boolean {
  return item.variable === variable && item.unit === unit &&
    item.forecastProvider.trim().length > 0 &&
    item.observationProvider.trim().length > 0 &&
    Number.isFinite(item.forecastValidTimeMs) &&
    Number.isFinite(item.observedTimeMs) &&
    Math.abs(item.forecastValidTimeMs - item.observedTimeMs) <= toleranceMs;
}
function toleranceValid(toleranceMs: number): boolean {
  return Number.isFinite(toleranceMs) && toleranceMs >= 0 && toleranceMs <= 3_600_000;
}
/** Bias, MAE and RMSE across a single comparable variable and unit. */
export function scoreContinuous(
  rows: readonly ContinuousVerificationPair[],
  variable: string,
  unit: string,
  toleranceMs = 15 * 60_000,
): ContinuousVerificationScore {
  if (!toleranceValid(toleranceMs)) throw new RangeError("invalid-verification-time-tolerance");
  const used = rows.filter(item => matched(item,variable,unit,toleranceMs) &&
    Number.isFinite(item.forecast) && Number.isFinite(item.observed));
  if (!used.length) return {samples:0,excluded:rows.length,bias:null,mae:null,rmse:null};
  const errors = used.map(row=>row.forecast-row.observed);
  const mean = (vals: readonly number[])=>vals.reduce((a,v)=>a+v,0)/vals.length;
  return {
    samples:used.length,
    excluded:rows.length-used.length,
    bias:mean(errors),
    mae:mean(errors.map(Math.abs)),
    rmse:Math.sqrt(mean(errors.map(e=>e*e))),
  };
}
/** Brier score uses normalized probabilities [0..1] and observed binary events.
 * Lower is better; this does NOT measure precision without real observations. */
export function scoreBinaryProbability(
  rows: readonly ProbabilityVerificationPair[],
  variable: string, unit: string,
  toleranceMs = 15 * 60_000,
): ProbabilityVerificationScore {
  if (!toleranceValid(toleranceMs)) throw new RangeError("invalid-verification-time-tolerance");
  const used = rows.filter(item=>matched(item,variable,unit,toleranceMs) &&
    Number.isFinite(item.probability) && item.probability>=0 &&
    item.probability<=1 && typeof item.occurred==="boolean");
  if (!used.length) return {samples:0,excluded:rows.length,brierScore:null};
  const total=used.reduce((sum,item)=>{
    const err=item.probability-(item.occurred?1:0);
    return sum+err*err;
  },0);
  return {samples:used.length,excluded:rows.length-used.length,
    brierScore:total/used.length};
}
