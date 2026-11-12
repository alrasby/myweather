/** Keep raster place labels from becoming huge stretched words while Leaflet
 * animates from one zoom to another. This is independent of precipitation,
 * satellite imagery and time-frame rendering.
 *
 * The Reference/World_Boundaries_and_Places layer is only displayed after its
 * *new* visible tiles have completed. During disconnected/offline requests it
 * remains hidden instead of exposing enlarged old raster labels.
 */
export type ZoomLabelEvents = {
  on(name: string, handler: () => void): unknown;
  off(name: string, handler: () => void): unknown;
};
export type ZoomLabelTileLayer = ZoomLabelEvents & { isLoading(): boolean };
export type ZoomLabelPane = { style: { opacity: string; transition: string } };
export type ZoomLabelScheduler = {
  setTimeout(handler: () => void, delay: number): number;
  clearTimeout(handle: number): void;
  requestAnimationFrame(handler: () => void): number;
  cancelAnimationFrame(handle: number): void;
};

export function manageRasterZoomLabels(
  map: ZoomLabelEvents,
  layer: ZoomLabelTileLayer,
  pane: ZoomLabelPane,
  scheduler: ZoomLabelScheduler,
  reduceMotion = false,
): () => void {
  let disposed = false;
  let zooming = false;
  let timer = 0;
  let frame = 0;

  const cancelQueued = () => {
    if (timer) scheduler.clearTimeout(timer);
    if (frame) scheduler.cancelAnimationFrame(frame);
    timer = 0;
    frame = 0;
    layer.off("load", showWhenReady);
  };

  const showWhenReady = () => {
    if (disposed || zooming || layer.isLoading()) return;
    layer.off("load", showWhenReady);
    if (timer) scheduler.clearTimeout(timer);
    timer = 0;
    if (frame) scheduler.cancelAnimationFrame(frame);
    frame = scheduler.requestAnimationFrame(() => {
      frame = 0;
      if (disposed || zooming || layer.isLoading()) return;
      pane.style.transition = reduceMotion ? "none" : "opacity 150ms ease-out";
      pane.style.opacity = "1";
    });
  };

  const onZoomStart = () => {
    cancelQueued();
    zooming = true;
    pane.style.transition = "none";
    pane.style.opacity = "0";
  };

  const onZoomEnd = () => {
    zooming = false;
    // The GridLayer 'load' event means all visible raster labels are ready,
    // not just one tile. Check once after Leaflet has processed zoomend too,
    // since all requested tiles may already be in the browser cache.
    layer.on("load", showWhenReady);
    timer = scheduler.setTimeout(showWhenReady, 80);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelQueued();
    map.off("zoomstart", onZoomStart);
    map.off("zoomend", onZoomEnd);
    map.off("unload", dispose);
  };

  map.on("zoomstart", onZoomStart);
  map.on("zoomend", onZoomEnd);
  map.on("unload", dispose);
  return dispose;
}
