import test from "node:test";
import assert from "node:assert/strict";
import { WeatherApiTiles, weatherApiStamp, weatherApiTileUrl, weatherApiForecastTime } from "./weatherApiTiles.ts";

test("UTC timestamp includes exact date and padded hour", () => {
  assert.equal(weatherApiStamp(Date.parse("2026-11-11T05:59:00Z")), "2026111105");
  assert.equal(weatherApiStamp(Date.parse("2026-12-31T23:00:00Z")), "2026123123");
});
test("public no-key weatherapi URLs are restricted to known map layers", () => {
  assert.equal(weatherApiTileUrl("precip", Date.parse("2026-11-11T05:10:00Z")),
    "https://weathermaps.weatherapi.com/precip/tiles/2026111105/{z}/{x}/{y}.png");
  assert.throws(() => weatherApiTileUrl("cloud" as never, Date.now()));
});
test("timestamps never exceed 72 hour published horizon", () => {
  const now = Date.parse("2026-11-11T08:25:00Z");
  assert.equal(weatherApiForecastTime(Date.parse("2026-11-11T08:01:00Z"), now),
    Date.parse("2026-11-11T08:00:00Z"));
  assert.equal(weatherApiForecastTime(Date.parse("2026-11-14T08:00:00Z"), now), null);
  assert.equal(weatherApiForecastTime(Date.parse("2026-11-11T07:00:00Z"), now), null);
});

type EventName = "load" | "tileerror";
class FakeMap {
  layers = new Set<FakeTile>();
  addLayer(layer: FakeTile) { this.layers.add(layer); }
  hasLayer(layer: FakeTile) { return this.layers.has(layer); }
  removeLayer(layer: FakeTile) { this.layers.delete(layer); }
}
class FakeTile {
  listeners = new Map<EventName, Array<() => void>>();
  opacity = 0;
  container = { style: { transition: "" } };
  url: string;
  constructor(url: string) { this.url = url; }
  on(event: EventName, callback: () => void) {
    const list = this.listeners.get(event) ?? [];
    list.push(callback);
    this.listeners.set(event, list);
  }
  getContainer() { return this.container; }
  setOpacity(opacity: number) { this.opacity = opacity; }
  addTo(map: FakeMap) { map.addLayer(this); return this; }
  fire(event: EventName) { for (const listener of this.listeners.get(event) ?? []) listener(); }
}
class FakeLeaflet {
  tiles: FakeTile[] = [];
  tileLayer(url: string) {
    const layer = new FakeTile(url);
    this.tiles.push(layer);
    return layer;
  }
}
function makeTiles() {
  const L = new FakeLeaflet();
  const map = new FakeMap();
  const signals: Array<[boolean, number | null]> = [];
  let clock = Date.parse("2026-11-11T08:25:00Z");
  const controller = new WeatherApiTiles(L as never, map as never, (visible, hour) => signals.push([visible, hour]), () => clock);
  return { L, map, signals, controller, setClock: (time: number) => { clock = time; }, getClock: () => clock };
}
test("ready tiles never hide native imagery before frame is completely loaded", () => {
  const { L, map, signals, controller, getClock } = makeTiles();
  try {
    controller.show("precip", getClock());
    assert.equal(L.tiles.length, 1);
    assert.deepEqual(signals, []);
    assert.equal(L.tiles[0]!.opacity, 0);
    L.tiles[0]!.fire("load");
    assert.deepEqual(signals, [[true, Date.parse("2026-11-11T08:00:00Z")]]);
    assert.equal(L.tiles[0]!.opacity, 0.86);
    assert.equal(map.layers.size, 1);
    controller.show("precip", getClock());
    assert.equal(L.tiles.length, 1);
  } finally { controller.destroy(); }
});
test("switching physical variable removes misleading old precipitation image before loading wind", () => {
  const { L, map, signals, controller, getClock } = makeTiles();
  try {
    controller.show("precip", getClock());
    L.tiles[0]!.fire("load");
    controller.show("wind", getClock());
    assert.equal(map.layers.has(L.tiles[0]!), false);
    assert.equal(L.tiles.length, 2);
    assert.deepEqual(signals.slice(-1), [[false, null]]);
    L.tiles[1]!.fire("load");
    assert.deepEqual(signals.slice(-1), [[true, Date.parse("2026-11-11T08:00:00Z")]]);
  } finally { controller.destroy(); }
});
test("tile network failure keeps original map available and does not emit loaded state", () => {
  const { L, map, signals, controller, getClock, setClock } = makeTiles();
  try {
    controller.show("precip", getClock());
    L.tiles[0]!.fire("tileerror");
    L.tiles[0]!.fire("load");
    assert.equal(map.layers.size, 0);
    assert.deepEqual(signals, []);
    controller.show("precip", getClock());
    assert.equal(L.tiles.length, 1);
    setClock(getClock() + 13_000);
    controller.show("precip", getClock());
    assert.equal(L.tiles.length, 2);
  } finally { controller.destroy(); }
});
test("seeking far ahead drops stale old tile while the new hour is loading", () => {
  const { L, signals, controller, getClock } = makeTiles();
  try {
    controller.show("tmp2m", getClock());
    L.tiles[0]!.fire("load");
    controller.show("tmp2m", getClock() + 6 * 3600000);
    assert.equal(L.tiles.length, 2);
    assert.deepEqual(signals.slice(-1), [[false, null]]);
  } finally { controller.destroy(); }
});
