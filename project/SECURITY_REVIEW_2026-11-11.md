# Security review — MyWeather — 2026-11-11

## Scope

Reviewed the locked JavaScript dependency graph (589 original lockfile nodes), selected Android security settings, application authentication imports, and CI release checks. This is a source/dependency audit, **not** a penetration test or a claim that all security risks are eliminated.

## Dependency findings and remediation

Before remediation: **14 npm audit findings (2 low, 10 moderate, 1 high, 1 critical)**; `npm audit --omit=dev` found **8 production findings**.

Changes performed with npm's lockfile solver, without `--force` or arbitrarily changing package integrity metadata:

| Component | Before | Patched lock | Risk addressed |
| --- | --- | --- | --- |
| better-auth, @better-auth/* adapters | 1.6.33 | 1.7.21 | Critical plus low auth advisories |
| zod | 4.6.5 | 4.6.7 | High |
| seroval | 1.6.9 | 1.8.1 | Moderate |
| glob | 13.0.6 | 14.0.5 | Moderate |
| minimatch in glob / TypeScript parser tree | 10.2.6 | 11.0.8 | Moderate |
| rimraf | 6.1.3 | 6.1.4 | Indirect glob advisory |

The TypeScript ESLint override is **scoped only** to `@typescript-eslint/typescript-estree > minimatch` so unrelated older `minimatch` consumers retain their compatible versions.

Npm's resolver reported **0 findings in both the complete and production-only audits**. The normal CI now performs both audits on committed files and fails whenever either reports a known finding, including development tools. Treat the CI run on the final committed lockfile as the authoritative sign-off, not the temporary resolver probe.

## Compatibility checks

- CI: `npm ci` from committed lockfile, upgraded Better Auth OAuth/TanStack/React export smoke, TypeScript ESLint parser + scoped glob-matcher smoke, TypeScript project check, all existing unit/weather source tests, Capacitor Android build/sync, Gradle debug unit tests, Android Lint.
- The release signing step validates the established signing certificate, package name, build identity, and zip alignment; secrets are supplied by GitHub Actions rather than committed.
- `capacitor.config.ts` explicitly disables WebView debugging and mixed HTTP content. Android fine/coarse location permissions support the requested GPS compass features.
- The Android manifest currently permits OS-managed app backups. This is a **privacy/configuration consideration**, not one of the npm findings; backup policy should be revisited for a public release if the app begins persisting sensitive account/session information. Do not silently disable expected settings restore for an existing user during this narrowly scoped dependency patch.

## Better Auth 1.7 client API migration

The official 1.7 upgrade removed `genericOAuthClient()` and `authClient.signIn.oauth2({ providerId })`. Updated `src/lib/auth/client.ts` to use `authClient.signIn.social({ provider: providerId })` and the standard client without the removed plugin. New local generic provider callback path is `/api/auth/callback/:providerId` (formerly `/api/auth/oauth2/callback/:providerId`). If auth is enabled against the external broker, **the broker's registered redirect URLs must be verified/updated** before rollout; this requires access to its OAuth registration. The Android weather application ships with auth disabled by default. Unit/type/API smoke tests cannot perform a real OAuth redirect.

## Auth migration caveat

`better-auth` is actually imported in `src/lib/auth/server.ts` and `client.ts`. Do not remove or mock it out. The 1.7 upgrade includes potential database schema / OAuth changes for feature-specific deployments: <https://better-auth.com/docs/1.6/guides/1-7-upgrade-guide>. Before enabling auth on a production server that has real user accounts, generate/review the corresponding schema migration and test OAuth sign-in, session recovery and sign-out **against that environment**. CI cannot access external identity-provider credentials or production databases; source, exports and unit tests cannot substitute for those checks.

## Release verdict

A zero-advisory CI plus Android Lint is required before **merging for a phone test**. **Public release** additionally requires device smoke testing and live authentication migration/sign-in testing if auth is enabled. Keep security scanning as a recurring CI gate so new registry advisories cannot silently reappear.
