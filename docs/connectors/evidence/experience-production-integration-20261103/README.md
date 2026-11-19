# Production integration: local proof, activation disabled

Final base: `7a2f3cc9b1f610d33b5c6da49147166f814e2404` (`origin/main` when reconciled).
The initial base was `930ecba`. The intermediate `932a38e` added 143 PiggyVest
paths with no overlap; the final 69-path update overlapped only `turbo.json`.
Its environment key and the experience qualification task were both preserved
with a validated three-way merge. No payment/refund flows were exercised.
Worktree: `/Users/mac/.codex/worktrees/experience-recovery/Baci-app`.
This is a local implementation and validation record, not a production release.

## Implemented

- Explicit production composition connects the existing MCP dispatcher to normal
  owner authorization, source/build lifecycle, prerender preview, performance
  retention and the existing Baci storefront runtime. No AI provider is called.
- Each owner operation resolves the merchant slug under normal auth/RLS and uses
  the trusted canonical-base resolver. Tenant pipelines retain no request client.
  Domain changes require a matching rebuild; artifacts are never retargeted.
- The compiled bridge accepts the canonical merchant origin and one exact HTTPS
  Baci preview origin, with the parent-window check and first-port binding intact.
  Build qualification covers both origins, three browsers and two widths.
- Runner requests and responses are signed, bounded, toolchain-bound and protected
  against replay. A 60-second request TTL leaves 30 seconds of clock-skew headroom.
  The Linux adapter uses the existing fixed OCI policy and `runsc --network=none`,
  noninteractive commands, limited output/deadlines and per-job cleanup.
  Signed owner/public lanes reserve a slot for owner work; public callers can
  dispatch only prerender jobs and cannot occupy both execution slots.
- Private delivery rechecks the scoped anonymous binding-liveness RPC on every
  resource. Public delivery reads the normal anonymous projection, rechecks
  publication after all resource reads, and rechecks catalog/binding after render.
  Execution must use a separate cookie site. Documents retain inert initial
  controls, SRI, no-store/noindex and restrictive CSP without payment/network access.
- Public rendering reuses the bounded fragment cache, keyed by exact binding,
  manifest and bootstrap. It does not cache credentials, launch documents or
  authorization. Catalog changes invalidate the key; withdrawal denies output.
- The append-only HTTPS-origin migration keeps the existing ownership, RLS and
  verifier boundaries. It was applied only to disposable local databases.
- Production registration does not receive the local feature-gate bypass.
  Host CSP admits the configured execution origin only for frames and removes it
  on uninstall. Protected proxy/config/environment files were not changed.
- A finalized build with a missing renderer can repair only that companion after
  two matching independent recompilations of the exact owned source/client binding.
  It neither recreates the database build nor repeats capture/publication. Corrupt
  companions are not overwritten and expired repair jobs fail closed.
- Performance reads use the declared read scope; writes retain the write-scope
  requirement. Transient bundles are removed on success and failure.

## Local validation

- 12 affected web test files: **59 tests passed**.
- 10 affected runner/browser test files: **37 tests passed**.
- SDK package: **11 tests passed**, typecheck passed, browser bundle built (10.6 KiB).
- Live normal-role Data API and gVisor qualification: **2 tests passed**. These
  cover 12 browser cells (Chromium/Firefox/WebKit × 390/1440 × merchant/Baci
  preview origins), private prerender delivery, wrong-owner rejection, anonymous
  liveness checks, denied anonymous table reads, session revocation and zero
  publication heads. HTTPS document origins are intercepted inside the offline
  sandbox; this does not qualify deployed TLS or network latency.
  The real auth/RLS fixture also repairs a lost companion for the same finalized
  build and confirms exactly one committed build afterward.
- A separate live HTTPS semantic-capture regression failed before the frame-origin
  fix and passed afterward. The later assertion correction uses the actual
  semantic-tree contract (heading tags/text), not accessibility roles.
- Runner, authoring and commerce TypeScript scopes passed. Targeted Biome checked
  57 files successfully. Migration source hashes match both replay registrations.
- One matrix run during concurrent local checks failed with `RUNNER_UNAVAILABLE`;
  a serial retry passed. The original failure's cause was not confirmed. Deadlines
  and budgets were not relaxed, and this is not clean performance qualification.
- The full local matrix and scope/cleanup regressions ran at `932a38e`. The final
  unrelated PiggyVest/Turbo refresh preserved all experience runtime source bytes;
  affected composition/build smoke tests, typechecking and JSON checks were rerun.
- Existing Orbit preview remained HTTP 200 at `http://localhost:43178/qa1`. That
  server serves the previously built Orbit UI, not a production activation of
  these new ports. Earlier checkout/CWV evidence remains in the sibling
  `experience-sandbox-checkout-cwv-20261103` directory.

No hosted migrations, publication actions, orders, payments, production settings,
infrastructure changes or paid review/AI credits were used.

## Review status

The included CodeRabbit review completed with warnings and 7 issues, including
duplicate clock-skew and frame-origin reports. The functional issues, supervisor
extraction and documentation wording were fixed and tested. The suggested blanket
DDL guards were declined: the current repository rule calls for guards only when
they preserve the schema assertion. This migration deliberately fails on missing
prior constraints or an unexpected existing function rather than hiding drift.

Two subsequent included reviews completed with 4 issues each. Valid findings about
public-render isolation, renderer recovery, read-only scope and transient cleanup
were fixed with failing-then-passing regression tests; the type-narrowing cleanup
was also applied. Repeated DDL-guard suggestions were declined for the same schema
assertion reason. Scope/rate-limited attempts were retried using included allowance;
paid credits were never enabled. Post-review fixes passed targeted tests/typechecks,
but **there is no independently re-reviewed final commit or candidate-wide CI
all-clear**. Exact review status and pending gates are in `receipt.json`.

## Operator integration and rollback

Construct `createProductionExperienceIntegration` with the existing normal
connector authenticator/user-client resolver, a normal anonymous public client,
trusted canonical-domain resolution, safe owner bootstrap and scoped verifier
callbacks. Keep signing keys in the trusted control plane. Mount its output-only
`deliver(Request)` handler behind a distinct HTTPS execution site. Explicitly
register its composition with `configureProductionExperienceBoot`; no automatic
environment discovery or feature activation was added.

The Linux runner requires a separately qualified, immutable installation in the
existing fixed rootfs layout and a matching `verifyInstallation` receipt. That
verification must establish actual workers, policies, runtime/browser versions
and installation integrity; merely echoing the configured digest is insufficient.
No production Linux installation or HTTPS ingress was provisioned here. Every
application/proxy worker must receive the trusted startup configuration; process
globals do not propagate across processes. This pilot uses one process and an
owned persistent volume; private preview tickets deliberately fail closed after
a restart. HA/distributed replay storage remains a rollout requirement if used.

For rollback, call the boot uninstaller, then `integration.dispose()`. This removes
MCP/owner/storefront registration and the added frame origin, rejects new auth and
runner work, discards tenant pipelines, and denies output. Do not delete merchant
data or reverse historical migrations. The new origin constraint remains compatible
with the previous local origins. Rollback does not publish a replacement head.

## Remaining release gates

1. Complete the final included review at the frozen source, then obtain required
   CI/review for an actual candidate commit on current main. The full web-suite
   and approved-source guards remain separate from the targeted checks above.
2. Qualify the real Linux installation, scoped verifier provisioning, HTTPS/cookie
   isolation, domain routing, worker startup, expiry/revocation and rollback.
3. Extend and qualify the HTTPS performance-reference path: the existing reference
   benchmark harness is still loopback-only, so production-origin performance
   reports remain unqualified. Then obtain clean end-to-end CWV measurements.
   Earlier host-contaminated samples remain unqualified; functional HTTPS checks
   do not establish field CWV or INP.
4. Obtain separate authorization for deployment, activation or publishing.

`releaseQualified=false`, `publishingReady=false`.
