import assert from "node:assert/strict";
import { test } from "node:test";
import { manageRasterZoomLabels } from "./rasterZoomLabels.ts";

function events() {
  const callbacks = new Map<string, Set<() => void>>();
  return {
    on(name: string, cb: () => void) {
      if (!callbacks.has(name)) callbacks.set(name, new Set());
      callbacks.get(name)!.add(cb);
    },
    off(name: string, cb: () => void) { callbacks.get(name)?.delete(cb); },
    emit(name: string) { for (const cb of [...(callbacks.get(name) ?? [])]) cb(); },
    count(name: string) { return callbacks.get(name)?.size ?? 0; },
  };
}

function harness(reduceMotion = false) {
  const map = events();
  const layer = { ...events(), loading: false, isLoading() { return this.loading; } };
  const pane = { style: { opacity: "1", transition: "none" } };
  const pending = new Map<number, () => void>();
  let id = 0;
  const scheduler = {
    setTimeout(fn: () => void, _delay: number) { pending.set(++id, fn); return id; },
    clearTimeout(n: number) { pending.delete(n); },
    requestAnimationFrame(fn: () => void) { pending.set(++id, fn); return id; },
    cancelAnimationFrame(n: number) { pending.delete(n); },
  };
  const flush = () => {
    for (let turn = 0; turn < 4 && pending.size; turn++) {
      const jobs = [...pending.entries()];
      pending.clear();
      for (const [, job] of jobs) job();
    }
  };
  const cleanup = manageRasterZoomLabels(map, layer, pane, scheduler, reduceMotion);
  return { map, layer, pane, flush, pending, cleanup };
}

test("zoom hides stretched raster labels until the new layer has loaded", () => {
  const h = harness();
  h.map.emit("zoomstart");
  assert.equal(h.pane.style.opacity, "0");
  h.layer.loading = true;
  h.map.emit("zoomend");
  h.flush();
  assert.equal(h.pane.style.opacity, "0", "never expose enlarged old labels");
  h.layer.loading = false;
  h.layer.emit("load");
  h.flush();
  assert.equal(h.pane.style.opacity, "1");
  assert.equal(h.pane.style.transition, "opacity 150ms ease-out");
  h.cleanup();
});

test("a repeated pinch cancels obsolete label reveals", () => {
  const h = harness();
  h.map.emit("zoomstart");
  h.map.emit("zoomend");
  h.map.emit("zoomstart");
  h.flush();
  assert.equal(h.pane.style.opacity, "0");
  h.map.emit("zoomend");
  h.flush();
  assert.equal(h.pane.style.opacity, "1");
  h.cleanup();
});

test("labels respect Reduced Motion and do not hold stale event listeners", () => {
  const h = harness(true);
  h.map.emit("zoomstart");
  h.map.emit("zoomend");
  h.flush();
  assert.equal(h.pane.style.transition, "none");
  h.map.emit("unload");
  assert.equal(h.map.count("zoomstart"), 0);
  assert.equal(h.map.count("zoomend"), 0);
  assert.equal(h.layer.count("load"), 0);
  assert.equal(h.pending.size, 0);
  h.cleanup();
});

test("offline label tiles remain hidden until a genuinely complete raster set arrives", () => {
  const h = harness();
  h.layer.loading = true;
  h.map.emit("zoomstart");
  h.map.emit("zoomend");
  h.layer.emit("load"); // spurious event; isLoading still true
  h.flush();
  assert.equal(h.pane.style.opacity, "0");
  h.layer.loading = false;
  h.layer.emit("load");
  h.flush();
  assert.equal(h.pane.style.opacity, "1");
  h.cleanup();
});
