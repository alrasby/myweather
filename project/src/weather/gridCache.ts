import type { GridField } from "./types";
const TTL = 2 * 60 * 60_000;
async function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    const request = indexedDB.open("myweather-map-v1", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("grids", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
export async function readGrid(id: string, allowStale = false): Promise<GridField | null> {
  try {
    const db = await database();
    if (!db) return null;
    return await new Promise((resolve) => {
      const req = db.transaction("grids").objectStore("grids").get(id);
      req.onsuccess = () => {
        const row = req.result;
        db.close();
        resolve(row && Date.now() - row.saved < (allowStale ? 24 * 60 * 60_000 : TTL) ? row.grid : null);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}
export async function saveGrid(grid: GridField): Promise<void> {
  try {
    const db = await database();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction("grids", "readwrite"),
        store = tx.objectStore("grids");
      store.put({ id: grid.id, saved: Date.now(), grid });
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result.sort((a, b) => b.saved - a.saved);
        rows.forEach((row, i) => {
          if (i >= 12 || Date.now() - row.saved >= 24 * 60 * 60_000) store.delete(row.id);
        });
      };
      tx.oncomplete =
        tx.onerror =
        tx.onabort =
          () => {
            db.close();
            resolve();
          };
    });
  } catch {
    /* Cache failure must not stop weather loading. */
  }
}
