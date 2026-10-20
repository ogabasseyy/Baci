# @baci/shared

Platform-free code shared by `apps/web`, `apps/mobile-storefront`, and
`apps/mobile-admin`. This package is the home for logic that more than
one app needs and that does not depend on a runtime platform.

## Contributor rule

Pure logic with **two or more consumers** that is **platform-free**
(no Next.js, React Native, Expo, Node-only, or DOM-only APIs) lands in
`@baci/shared` **first**, and each app consumes it through a thin
adapter/wrapper that keeps its existing call-site signatures.

Server code stays the trust/pricing authority: sharing a schema, type,
or pure calculation never moves authorization, pricing, or persistence
decisions into clients.

## Decision rule for moving code here

A module qualifies when all three hold:

1. **≥2 consumers** — at least two apps hold the same concept today
   (or a second consumer is landing in the same wave).
2. **Platform-free on inspection** — the moved core imports no
   platform APIs. Platform pieces (`AppState`, `Platform`, lazy Expo
   module loaders, storage, Supabase clients) are injected as
   per-app adapters, never imported by the shared core.
3. **One PR ≤ ~400 changed lines** — if a move exceeds the budget,
   split it (shared module first, then one adoption PR per app).

If any condition fails, keep the code in the app and record the
candidate in the consolidation audit instead of forcing the move.

## Placement and subpath exports

- Code lives under a per-domain directory in `src/` (`cart`,
  `contracts`, `constants`, `schemas`, `receipt`, `vtu`, …).
- Every domain is consumed through its subpath export in
  `package.json` (`@baci/shared/cart`, `@baci/shared/vtu`, …), not by
  deep relative paths into `packages/shared/src/…`. When you add a
  domain or a separately consumed module, add its subpath export in
  the same PR.
- The root entry (`@baci/shared`) re-exports broadly for legacy
  consumers; new code should prefer the domain subpath.

## Characterization fixtures (single oracle)

Shared behavior changes are pinned by **single-oracle characterization
fixtures** that live in `src/test-fixtures/` and are consumed through
subpath exports (`@baci/shared/test-fixtures/<name>`) by every app's
tests. Do not copy a fixture into an app: one oracle, many consumers,
so a behavior change is reviewed in exactly one place.

Fixtures capture the contract clients actually parse (for HTTP, the
response-builder output), and a fixture that is meant to prove a
regression must fail against the pre-fix code.

Fixture doubles must be runner-agnostic (no `vitest`/`jest` imports):
fixtures are consumed by both runners. The runner-agnostic mock
helper used by the piggyvest schedule fixture implements only this
documented subset — `mock.calls`/`results`/`invocationCallOrder`,
`mockClear`/`mockReset`, `mockReturnValue(Once)`,
`mockImplementation(Once)`, `mockResolvedValue(Once)`,
`mockRejectedValue(Once)` — do not assume full `vi.fn`/`jest.fn`
parity (e.g. no `mock.contexts`, `mockRestore`, or
`getMockImplementation`); extend the helper deliberately if a
consumer needs more. Note the helper's mocks are not registered with
either runner, so `jest.clearAllMocks()` / `vi.clearAllMocks()` do
not reset them — call `mockClear()` explicitly — and
`mock.invocationCallOrder` uses a module-level counter, so it is
only comparable as relative ordering within a test process.
`mock.results` mirrors runner behavior: a rejected promise is
recorded as a `return` of that promise; only synchronous throws are
recorded as `throw`.

Fixtures are exported as ordinary subpaths, so they are technically
resolvable from production bundles (Next.js, Metro). The boundary is
enforced by test, not by the exports map:
`apps/web/src/lib/shared-test-fixtures-import-boundary.test.ts` (plus
per-app mirrors in both mobile apps) fails
if any scanned non-test source in the three apps, the other workspace
consumers (packages/tiktok-business, the Cloudflare evidence worker),
or in this package
imports a fixture by a literal subpath or deep-relative specifier.
Scan exclusions: generated-output directories (node_modules, .git,
.turbo, .gradle, Pods, DerivedData, .next, .expo, web-build) are
skipped at any depth; build, dist, and coverage are skipped at a scan
root or under native ios/android trees; root-level developer tooling
directories (apps/*/tools, which run in Node and are never bundled)
are exempt from the test-support pattern but are still scanned by a
fixture-pattern-only pass, so a direct shared-fixture import in
tooling is flagged. A fixture import inside an excluded tree is a
code-review catch, not a guard catch.
Symlinks that resolve inside a scan root are followed (with cycle
protection); links resolving outside every scan root, and broken
links, are skipped. The guards
match literal specifiers and quoted fixture-tree prefix constants
(the shape used to assemble a specifier dynamically); specifiers
built from variables at runtime remain a code-review catch, not a
guard catch. Never import a fixture
from non-test code. These guard suites are explicitly force-run in
the targeted CI test-plan branches and the mobile-admin guardrail
job, and run as part of the full suites in `full-affected` mode (see
`.github/workflows/ci.yml`); the `config-smoke` mode (Turbo
env-allowlist changes only) does not run them. Enforcement therefore
does not depend on changed-file test selection in the modes that can
change fixture imports.

## Platform isolation

This package declares only `@noble/hashes` and a Zod peer dependency
(`^3.0.0 || ^4.0.0`; the in-tree code already uses Zod-4-only APIs
such as `z.iso.datetime({ offset: true })`, so the de-facto floor is
Zod 4). It is consumed by Next.js and by Metro
(`unstable_enablePackageExports` is enabled in the mobile apps), so:

- No `react`, `react-native`, `expo-*`, `next`, or Node-only imports
  in shared code.
- Anything platform-bound stays in the app behind an injected adapter
  (see the decision rule). An isolated `./native` subpath with
  optional peers is a last resort and requires verifying Metro and
  Next.js resolution/typecheck in the same PR.

## Tests

```bash
pnpm --filter @baci/shared test
pnpm --filter @baci/shared typecheck
```
