# Local security repair for picomatch

This is a temporary, repository-local fork of npm `picomatch@4.0.7`, distributed under the original MIT license in LICENSE. The local version is `4.0.8+myweather.1`. It is not an upstream release and is not published to npm.

GHSA-fc5q-39xc-vjpf / CVE-2026-112366 reports catastrophic regex backtracking for single-branch repeated wildcard extglobs, including `+(*)` and `+(*a)`. The official advisory had no patched release when checked on 2026-11-18.

Only lib/parse.js differs from the upstream runtime source. Its upstream SHA-256 is `4e1e05447668aa1e94366c5516a2bcd8f5fff800cc92b1d0cd7d77703b8618c4`.

The parser now detects actual wildcard tokens in single-branch repeated extglobs. For a simple segment glob containing a star, concatenating matching segments yields a string matched by that same glob. The parser keeps one body for `+()` or an optional body for `*()`, removing the nested unbounded quantifier while retaining the original path guards and capture wrapper. Complex single-branch wildcard bodies use the parser's existing conservative literalization behavior. Explicit `maxExtglobRecursion: false` retains upstream's documented opt-out from safeguards.

package.json overrides route build dependencies to this local source. The npm audit script is unchanged. CI first checks the installed resolution and exact parser hash, verifies normal glob behavior and capture handling, and runs attack regressions in a child process with a hard timeout.

Validation before adoption included 109,200 short-string match comparisons against the original version. The upstream main test suite was also run against both original 4.0.7 runtime files and repaired files. Both runs produced the same 1,987 passes and 11 existing failures caused by the newer test suite. No new upstream failures appeared.

When an official patched release becomes available, replace this local fork with that release, remove the direct local dependency/override and rerun the security, typecheck, Android build and application regression tests.
