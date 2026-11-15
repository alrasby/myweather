/** Bounded, source-only PNG disk cache for the optional off-device ECMWF gateway.
 * One process owns this directory. The render path is never allowed to grow it
 * without limit or to replace an image with an incomplete/invalid raster. */
import {mkdir, readdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {dirname, join, relative, sep} from 'node:path';
import {validPng} from './pngIntegrity.mjs';

const SOURCE_TILE = /^[0-9]{8}T[0-9]{4}Z\/\d{1,3}\/(cloud_cover|precipitation|snowfall_water_equivalent)\/[0-8]\/\d{1,3}\/\d{1,3}\.png$/;
const fail = (message) => Object.assign(new Error(message), {status: 507});
export function createDiskTileCache({root, maxBytes = 384 * 1024 * 1024, maxEntries = 30000}) {
  if (typeof root !== 'string' || !root || !Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('invalid-disk-tile-budget');
  const entries = new Map();
  let storedBytes = 0, evictions = 0, orphanTempsRemoved = 0, initialized = null, tail = Promise.resolve();
  // Serialize maintenance so two completed renders cannot both pass a quota
  // check and collectively exceed it. Reads remain concurrent.
  function exclusive(work) {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    return previous.then(work).finally(() => release());
  }
  const fullPath = key => {
    if (!SOURCE_TILE.test(key)) throw new Error('invalid-disk-tile-path');
    return join(root, ...key.split('/'));
  };
  async function evict(key) {
    const item = entries.get(key);
    if (!item) return;
    await unlink(fullPath(key)).catch(error => {
      if (error?.code !== 'ENOENT') throw error;
    });
    entries.delete(key);
    storedBytes -= item.bytes;
    evictions++;
  }
  async function makeRoom(newBytes, newEntries) {
    while (entries.size + newEntries > maxEntries || storedBytes + newBytes > maxBytes) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) throw fail('tile-cache-capacity');
      await evict(oldest);
    }
  }
  async function init() {
    if (!initialized) initialized = exclusive(async () => {
      await mkdir(root, {recursive: true});
      const listed = await readdir(root, {recursive: true, withFileTypes: true});
      const found = [];
      for (const dirent of listed) {
        if (!dirent.isFile()) continue; // never follow links or unknown trees
        const full = join(dirent.parentPath, dirent.name);
        const key = relative(root, full).split(sep).join('/');
        // A process killed between writeFile and atomic rename leaves a
        // quota-untracked .png.<pid>.<uuid>.tmp. Only remove our own exact
        // temporary naming pattern under the cache tree, never arbitrary files.
        const temp = /^(.*\.png)\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i.exec(key);
        if (temp && SOURCE_TILE.test(temp[1])) {
          await unlink(full).catch(error => {
            if (error?.code !== 'ENOENT') throw error;
          });
          orphanTempsRemoved++;
          continue;
        }
        if (!SOURCE_TILE.test(key)) continue;
        const info = await stat(full).catch(() => null);
        if (info?.isFile()) found.push({key, bytes: info.size, modified: info.mtimeMs});
      }
      found.sort((a, b) => a.modified - b.modified || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (const file of found) {entries.set(file.key, {bytes: file.bytes}); storedBytes += file.bytes;}
      await makeRoom(0, 0);
    });
    await initialized;
  }
  async function read(key) {
    const path = fullPath(key);
    await init();
    let image;
    try {image = await readFile(path);}
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await exclusive(async () => {
        const former = entries.get(key);
        if (former) {entries.delete(key); storedBytes -= former.bytes;}
      });
      return null;
    }
    if (!validPng(image)) {
      await exclusive(async () => {
        const former = entries.get(key);
        if (former) await evict(key);
        else await unlink(path).catch(error => {if (error?.code !== 'ENOENT') throw error;});
      });
      return null;
    }
    // Access-order LRU, including persisted files indexed on process startup.
    await exclusive(async () => {
      const former = entries.get(key);
      if (former) {entries.delete(key); entries.set(key, former);}
      else {
        entries.set(key, {bytes: image.length}); storedBytes += image.length;
        await makeRoom(0, 0);
      }
    });
    return image;
  }
  async function write(key, image) {
    const path = fullPath(key);
    if (!validPng(image)) throw new Error('invalid-source-raster');
    if (image.length > maxBytes) throw fail('tile-exceeds-cache-budget');
    await init();
    await exclusive(async () => {
      const old = entries.get(key);
      if (old) {entries.delete(key); storedBytes -= old.bytes;}
      try {
        await makeRoom(image.length, 1);
        await mkdir(dirname(path), {recursive: true});
        const temp = path + '.' + process.pid + '.' + randomUUID() + '.tmp';
        try {await writeFile(temp, image, {flag: 'wx'}); await rename(temp, path);}
        catch (error) {await unlink(temp).catch(() => {}); throw error;}
        entries.set(key, {bytes: image.length}); storedBytes += image.length;
      } catch (error) {
        // An attempted replacement cannot erase a previously accounted tile
        // from the quota index when disk-full or a filesystem write fails.
        if (old) {entries.set(key, old); storedBytes += old.bytes;}
        throw error;
      }
    });
  }
  function snapshot() {return {storedBytes, entries: entries.size, evictions, orphanTempsRemoved, maxBytes, maxEntries};}
  return {read, write, snapshot};
}
