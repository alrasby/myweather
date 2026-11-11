#!/usr/bin/env node
/** Security dependency upgrade runtime smoke (no external credentials). */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { betterAuth } from "better-auth";
import { bearer, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { createAuthClient } from "better-auth/react";
import parser from "@typescript-eslint/parser";

for (const [name, exported] of Object.entries({
  betterAuth, bearer, genericOAuth, tanstackStartCookies,
  createAuthClient,
})) {
  assert.equal(typeof exported, "function", name + " export changed across security upgrade");
}

const parsed = parser.parse("const safe: number = 42;\n", {
  sourceType: "module", ecmaVersion: "latest",
});
assert.equal(parsed.body[0]?.type, "VariableDeclaration");

// Specifically exercise the nested minimatch package used by the AST parser.
// Do not touch other legacy minimatch v3 consumers.
const require = createRequire(import.meta.url);
const typescriptEstreeEntry = require.resolve("@typescript-eslint/typescript-estree");
const estreeRequire = createRequire(typescriptEstreeEntry);
const installedMinimatch = estreeRequire("minimatch");
assert.equal(typeof installedMinimatch.minimatch, "function");
assert.equal(installedMinimatch.minimatch("src/weather/api.ts", "src/**/*.ts"), true);
assert.equal(installedMinimatch.minimatch("src/weather/api.ts", "src/**/*.jsx"), false);
const authClient = createAuthClient({ baseURL: "http://127.0.0.1:3000" });
assert.equal(typeof authClient.signIn.social, "function", "Better Auth 1.7 generic social client route");
console.log("SECURITY_COMPAT_OK Better Auth 1.7 social OAuth, TS parser, scoped minimatch matcher");
