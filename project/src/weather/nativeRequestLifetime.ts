/** Unlike fetch(), CapacitorHttp.request() has no AbortSignal. Releasing a
 * queue slot on JS cancellation overcommits real OS/native requests.
 * Keep the permit until the underlying plugin resolves OR rejects. */
export function trackUnstoppableRequest<T>(task:Promise<T>,release:()=>void):Promise<T>{
  let finished=false;
  const once=()=>{if(finished)return;finished=true;release();};
  // Catch both outcomes here; the caller can race its own timeout/abort.
  void task.then(once,once);
  return task;
}
