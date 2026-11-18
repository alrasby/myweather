import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const picomatch = require("picomatch");
const vendor = fileURLToPath(new URL("../vendor/picomatch/index.js", import.meta.url));

test("build tools resolve the reviewed local picomatch repair", () => {
  const expected = realpathSync(vendor);
  assert.equal(realpathSync(require.resolve("picomatch")), expected);
  for (const dependency of ["vite", "tinyglobby", "fdir", "unplugin"]) {
    const caller = createRequire(require.resolve(dependency));
    assert.equal(realpathSync(caller.resolve("picomatch")), expected, dependency);
  }
  const metadata = require("picomatch/package.json");
  assert.equal(metadata.version, "4.0.8+myweather.1");
  assert.equal(metadata.myweatherSecurityPatch.advisory, "GHSA-fc5q-39xc-vjpf");
  const parser = readFileSync(new URL("../vendor/picomatch/lib/parse.js", import.meta.url));
  assert.equal(createHash("sha256").update(parser).digest("hex"), "5577285c5d0aedf2812b058142f26f2f200cac67d3738c6455528ccd83a3a9f5");
});

test("single-branch repeated wildcard attacks finish within the process deadline", () => {
  const child = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const match = require(${JSON.stringify(vendor)});
    for (const options of [{}, { windows: true }, { capture: true }, { maxExtglobRecursion: 1 }]) {
      for (const pattern of ['+(*)b', '+(*a)b', '*(*)b', '*(*a)b', 'dir/+(*a)b/end']) {
        const attack = pattern.startsWith('dir/') ? 'dir/' + 'a'.repeat(80) + '!/end' : 'a'.repeat(80) + '!';
        assert.equal(match.isMatch(attack, pattern, options), false);
      }
    }
  `], { timeout: 2500, encoding: "utf8" });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test("repaired extglobs preserve ordinary matching and path boundaries", () => {
  for (const options of [{}, { windows: true }, { dot: true }, { capture: true }, { bash: true }]) {
    for (const [pattern, value, expected] of [
      ['+(*)c', 'abc', true], ['+(*a)', 'ababa', true], ['+(*a)', 'abab', false],
      ['*(a*b)', 'ababb', true], ['x*(a*b)y', 'xy', true], ['x+(a*b)y', 'xy', false],
      ['foo/+(*.js)/bar', 'foo/app.js/bar', true], ['foo/+(*.js)/bar', 'foo/app.ts/bar', false],
      ['+(abc)', 'abcabc', true], ['*(foo|bar)', 'foobar', true],
      ['+(*(a)|*(b))', 'abba', true],
    ]) assert.equal(picomatch.isMatch(value, pattern, options), expected, `${pattern} ${value}`);
  }
  assert.equal(picomatch.isMatch('foo/a/b.js/bar', 'foo/+(*.js)/bar'), false);
  const capture = picomatch.makeRe('pre+(*a)post', { capture: true }).exec('preabapost');
  assert.ok(capture);
  assert.equal(capture[1], 'aba');
});
