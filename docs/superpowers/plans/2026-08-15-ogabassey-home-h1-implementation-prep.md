# OgaBassey Home H1 Prep — Owner-Authorized Inert Implementation Note

**Lane ID:** `H1-IMPLEMENTATION-PREP-2026-08-15`

**Status:** non-normative preparation note. This note authorizes only isolated,
inert Hero/preload implementation preparation; it is not a V4 phase plan and
does not modify or extend the normative phase index.

**Owner authorization:** the owner has explicitly authorized this prep lane to
proceed while the strict V4 prerequisites remain unmet. That authorization does
not authorize normative H1, public activation, cache admission, deployment, or
any performance conclusion.

## Frozen reference and sequence

- **Normative reference (read-only):**
  `docs/superpowers/plans/2026-07-13-ogabassey-home-critical-shell-v4.md`
- **Restored contract SHA-256:**
  `3503ca9613b6a511b2e37fb3d35b48830d19e8559e7e3c5df136487fce9efdca`
- **Frozen base:** `bcdbf54cb591af2d9047afacaf75cdaaa29cccfa`
- **Normative phase index:** unchanged; this note is deliberately absent from
  its Required Phase Plans table.

Before any prep edit, verify that the reference contract is byte-equal to the
frozen current-main/origin-main copy, recomputes the restored hash above, and
has the frozen base as an ancestor. A contract/base change invalidates this
note; regenerate the note or stop. Never “fix” drift by editing the normative
contract in this lane.

The strict sequence remains P0 → H0-RUNNER → H0 → H0-MEASURE → H0.5 → H0.75 →
normative H1A/H1B/H1C1/H1C2/H1D1/H1D2 → H0R-H1-MEASURE. All of those gates are
unmet for this prep note. Normative H1 implementation and activation have not
started.

## Inert boundary

Every prep change must preserve all of the following:

- Controls remain `final-disabled+null`; no enable, publish, promotion,
  transition completion, or finalization state may be introduced.
- No public route/page/layout ownership or visible initial-HTML/RSC behavior is
  activated. Resource-hint output, if refactored, must remain behaviorally
  equivalent and fail-open.
- No cache-control/tag admission, proxy change, worker/provider/VPS change,
  migration, deployment, or `infra/cwv-runner` import is allowed.
- The H0-RUNNER remains the sole hard authority for controlled measurement and
  later activation. Ollama retirement status cannot waive or replace it.
- PSI, local timings, focused tests, and other prep evidence are diagnostic
  only; none is a causal, absolute, field, or activation gate.
- Tenant binding, publication guards, SEO/metadata, accessibility, adjacent
  routes, and existing request-scoped behavior remain unchanged.

## Hard prerequisites that remain gates

This note cannot satisfy, shorten, or relabel any prerequisite:

1. P0 recovery exact-head, migration-history, and production-coherence proof.
2. Owner-approved persistent H0-RUNNER host, read-only audit, and stable
   attestation; hosted CI is not equivalent.
3. Exact H0/H0-MEASURE deployment and declared controlled campaign.
4. H0.5 hard cache-safety/TTL decision and accepted H0.75 actual-route spike.
5. Normative H1A→H1D2 exact-head sequence, proxy approval where required,
   fleet/ACL safety closure, and the H0R-H1 activation gate.

The prep receipt must continue to mark these gates `unmet` until their own
authoritative evidence exists.

## Preparatory source inventory

The inert implementation work may cover only these current-main Hero/preload
files, each with its colocated/focused test:

- `apps/web/src/app/(storefront)/ogabassey/ogabassey-home-hero-resource-hints.ts`
- `apps/web/src/app/(storefront)/ogabassey/ogabassey-home-hero-resource-hints.test.ts`
- `apps/web/src/lib/ogabassey-home-hero-contract.ts`
- `apps/web/src/lib/ogabassey-home-hero-contract.test.ts`
- `apps/web/src/lib/ogabassey-home-hero-contract.renderer.test.ts`
- `apps/web/src/lib/ogabassey-home-hero-resource-hint-projection.ts`
- `apps/web/src/lib/ogabassey-home-hero-resource-hint-projection.test.ts`

The projection may centralize the existing slide-zero preload identity and
typed fail-closed parity checks. It must not read routes, request headers,
Supabase, control state, cache state, worker state, or provider responses. The
emitter retains its existing public signature and fail-open behavior.

Do not widen this inventory. `proxy.ts`, route/page/layout ownership beyond the
listed emitter, cache/runtime code, migrations, providers, VPS workers,
`infra/cwv-runner`, and deployment workflows are out of scope.

## Required validation for prep work

- Run the four focused suites covering the seven listed files.
- Run Biome/lint and TypeScript checks appropriate to the touched package.
- Run `git diff --check` and confirm every touched runtime/test file is below
  the repository 300-line ceiling.
- Perform a static import/diff review proving no forbidden boundary was added.
- Record all evidence as `PREP_DIAGNOSTIC`; never label it H0/H0R or activation
  evidence.

## Exit and stop conditions

An inert prep receipt may say `PREPARED_INERT` only when the source inventory,
tests, lint/typecheck, file-size, and diff checks pass while every hard gate
above remains explicitly unmet. The receipt must state that no public rendering,
cache activation, H0 runner gate, or performance claim occurred.

Any normative-contract edit, phase-index change, forbidden-boundary import,
control activation, public behavior change, or unverified gate is
`STOPPED_REROUTED`: preserve evidence, do not deploy or activate, and return to
the restored V4 sequence for a fresh reviewed phase plan.
