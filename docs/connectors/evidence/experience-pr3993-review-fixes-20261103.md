# PR 3993 review corrections — 2026-11-03

Review base: `6b9b0b362d5bb47a23160a3a176487ae50feb9f8`.
CodeRabbit remains skipped by owner instruction. These corrections require fresh GitHub review/CI; prior receipts do not approve the changed candidate.

| Finding | Correction / regression evidence |
| --- | --- |
| Owner-web publication bypasses MCP performance gate | Shared publication service checks fresh, build-bound qualification for requests and rechecks before owner confirmation. Owner composition receives the same trusted performance reader as MCP. Missing/failed reports reject before requesting or confirming an intent. |
| Cart observer quota becomes permanent after 64 operations | Evict only settled observers when capacity is needed. In-flight entries remain bounded/protected; receipt storage is not cleared. Regression completes 80 operations with an in-flight observer retained, and separately denies a 65th all-in-flight operation. |
| Home-only experience replaces native PDP | Check ownership of the already native-resolved canonical product route. Regression verifies home-only/editorial-only experiences do not claim PDPs and the actual categorized page continues through the native product loader. |
| Semantic fallback leaves a path-based merchant | Bind retained relative links to the trusted launch canonical base. No authored markup or executable links are admitted. |
| SDK navigation bypasses channel epoch tracking | Route updates use `channel.send`; regression exercises a valid SDK request and expects the epoch-2 route through the tracked channel. |
| Dynamic route regular expression warning | Match normalized, bounded path segments directly instead of constructing a regular expression. Preserve literal bracket and named-segment behavior. |
| Experience tsconfigs missing from normal typecheck | Append the existing experience typecheck task to the web typecheck script. The previously failing CI contract passes. |
| Publish scope downgraded to read RPC | New append-only `experience_authorize_publish` RPC rechecks live publish scope under the existing normal-owner/session/connection lock. Normal Data API test denies read-only, wrong-owner, anonymous and revoked connections. No hosted migration was applied. |
| Browser preparation assumes a local Colima installation | Explicit macOS/running-Colima preflight fails with a prerequisite explanation before any build/provisioning command on unsupported hosts. Native deployed execution remains the separate Linux runner. |

Semgrep's two additional parser diagnostics were also addressed without exclusions or policy changes: explicit named type exports replace `export type *`, and a test mock uses an equivalent type assertion instead of an unsupported generic import-call syntax.

Validation: 78 focused Vitest tests across 15 files; 6 Node contract/prerequisite tests; one disposable normal-auth/RLS database test. Experience runner/authoring/commerce TypeScript scopes and targeted Biome checks passed. Standard commit/push gates and fresh GitHub CI remain independently required.

The preceding CI head also failed the separate WebKit repair-pickup simulation at address selection/quote visibility. Main's corresponding run passed. That failure is not attributed to a cause yet and is not hidden or converted into a performance pass; retain the failure artifacts and inspect the fresh-head rerun if it persists. No repair/payment runtime change is included in these corrections.

Benchmarks remain parked. No deployment, storefront publication, real orders, payments, service-role commerce or paid AI reviews occurred. Existing installation/checkout/benchmark receipts remain historical and must not be relabeled as qualification of this changed source.

## Follow-up: checkout, projection ordering, replay capacity and tenant quotas

- A throwing published-head load now falls back to the merchant's native checkout. Both native template selections have regression coverage.
- Append-only migration `20261103203000_experience_public_manifest_order.sql` orders all three public JSON aggregates by authored ordinality, preserving route precedence. Public projection joins, grants and private-data exclusions are unchanged. Disposable PostgreSQL verification uses the anonymous read role; no hosted migration was applied.
- Replay admission retains every unexpired consumed nonce, with independent 4,096-entry owner/public lane budgets. Capacity returns 429; replay/invalid binding remains 409. Tests cover 1,100 signed requests in one window, expiration, 4,096 public admissions, reserved owner capacity and cross-lane replay. Replicas still require independent keys or a shared replay ledger.
- Preview admission uses authenticated merchant identity, an eight-launch/32 MiB tenant ceiling and the existing 32-launch/64 MiB global safety ceiling. Byte accounting includes pending launches, rewritten CSS and replacement prerender HTML. Resources stage atomically, with separate tenant/global metadata bounds. Two-merchant tests cover launch saturation and retained-byte prerender saturation.
- Focused verification: checkout/preview initial regressions failed before the fixes; runner throughput failed at the former 1,024 cap. Final checks include 19 runner transport tests, 16 preview/launch/migration-registry tests, 14 checkout/preview-reader consumer tests, 6 final quota tests, 5 prerender compilation tests, one disposable SQL projection test, and three experience TypeScript projects.
- CI's three Mac/Colima/gVisor installation and HTTPS qualification tests now require explicit `BACI_LOCAL_EXPERIENCE_QUALIFICATION=1`. They are skipped in ordinary unit CI, not counted as qualified. Run them deliberately with that variable and the provisioned fixture; benchmarks remain parked. A stale source assertion now checks the emitted JSON readiness options.
- No deployment, publication, orders, payments, hosted data changes or extra review-provider calls occurred. Remaining GitHub review findings and exact-head CI are separate release gates.
