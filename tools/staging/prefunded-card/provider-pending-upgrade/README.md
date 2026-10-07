# Pending-provider upgrade preparation

The follow-up [Next release handoff](NEXT-RELEASE.md) supplies an isolated source
kit, exact predecessor-only source preflight, offline VPS build commands and an
additive archive/manifest finalizer. It preserves the parent's newly completed
TEST collection and r3 promotion without transfer. Source preparation does not
assert that payment state independently and never retries the collection.

This sidecar only builds local candidates. Original r8 authority, receipts,
archive/manifest pins and the October 6 15:59:10 UTC deadline remain intact.
No installer, network operation, payment, root grant, configuration mutation or
production action is included. Parent review owns terminal and financial recovery.

Run `node tools/staging/prefunded-card/provider-pending-upgrade/build.mjs
/private/tmp/<unique-new-directory>` from the canonical worktree. The existing
esbuild worker builder produces background, snapshot and readiness bundles;
snapshot/readiness are comparison artifacts and are not authorized replacements.
The existing public source builder records original source hashes, its generated
public-env boundary and every rewrite. Its bounded esbuild handler is a review
artifact with external npm packages, including Next and server-only. It cannot
replace a Next standalone archive or a compiled Next route chunk directly.
No full build, dependency install or global validation is required by this lane.

`preparation.json` pins artifacts; `full-static-graph.json` includes local
type-only dependencies and external import edges for all four consumer roots.
The worker manifest separately pins bundled package sources and compilation
inputs. `original-authority.json` preserves original authority values plus the
financial activation, public mutation and deadline renewal tooling digests.
`source-change.json` proves the added line and reconstructed old source hash;
that reconstructed hash is not proof of the actual deployed predecessor.

## Runtime consumers

- Public: card-checkout GET/POST/PATCH route -> public runtime -> checkout
  composition -> provider. The return page and CSRF route are present in the
  public source snapshot; they do not consume the provider.
- Background: run-prefunded-card-background -> recovery composition -> provider.
  Scheduled and manual background invocations must use the same candidate bytes.
- Standalone recovery: run-prefunded-card-checkout-recovery -> recovery
  composition -> provider. Treat any separately installed CLI as an additional
  affected artifact; do not run it during this upgrade.
- Owner proof: owner-payment-proof/collect -> provider. Its source graph is
  inventoried only. Do not rebuild/install/invoke owner proof without parent
  review of its own sealed artifact. No owner proof source is changed here.

## Exact-predecessor transaction contract

1. Parent independently pins a fresh complete baseline from the actual isolated
   runtime: original r8 seal, public archive/manifest/source manifest and launcher,
   background archive/manifest/code, complete source closures, receipts, config
   hashes, trees with modes/owners/link counts, image digests, container labels,
   mounts, units, schedule state, and protected financial fingerprints. Historical
   pre-r8 worker labels are not current-predecessor authority. Missing artifacts
   or any intervening drift refuses the operation. Retain the actual original r8
   sealed bundle byte-for-byte; this directory never regenerates its seal.
2. Compare full old/new runtime source closures. The provider's single added
   abandoned-status line is the only permitted source delta. Preserve generated
   public-env rewrites and all external dependency versions. Rebuild on drift;
   never patch a compiled blob, relax a pin or edit a global seal by hand.
3. Integrate the handler's source change into a parent-reviewed bounded Next
   release using an established Next build context. Preserve every unaffected
   archive file. Verify archive and manifest with public_artifact.validate_archive,
   pin all changed files, and prove Next dispatcher compatibility. This sidecar's
   handler is explicitly insufficient for that step. Parent must provide an
   approved integrated public successor before contract validation can pass.
4. Parent independently approves exact baseline and successor JSON SHA256s.
   `reviewContract` checks these supplied bytes, original authority, complete
   provider-only source delta, bounds, deadline margin, fresh parent evidence,
   denied unauthenticated methods and unchanged protected fingerprints. It is a
   local evidence validator, not a collector or executable transaction.
5. Under one exclusive upgrade lock, deny public mutations, stop background
   scheduling and new dispatch, and wait for inflight calls to settle. Never kill
   an ambiguous provider call then retry. Capture schedule/config/receipt bytes
   and stopped-container state. Stage public and background as immutable private
   siblings on the same filesystem, validate exact trees and images, and retain
   complete predecessor trees, receipts, manifests and schedule state for rollback.
6. Reverify predecessor under the lock. With both consumers stopped, rename-aside
   both old trees and rename-in both candidate trees, updating only independently
   reviewed successor receipts/labels. Fsync files and parent directories; retain
   a durable phase journal. Two renames are not an atomic multi-service transaction:
   interrupted phases require state classification by exact hashes before recovery.
7. Before any background start, prove mounted artifact hashes and isolation and
   unauthenticated GET/POST/PATCH 401; prove authenticated capability GET 200 with
   enabled false/max zero and POST/PATCH 503. Check callback/CSRF and their assets
   through existing probes. Do not call provider verification, run --check paths
   that contact providers, or execute background as a post-check. Independently
   read protected state in a repeatable-read read-only transaction; compare full
   fingerprints, principal/budget, deadline, ACL/password/role metadata and history.
8. Failure keeps mutation gates closed and scheduling stopped. Under the same
   lock restore both exact old trees/receipts/labels, classify an interrupted
   rename without overwriting unknown files, fsync and verify old mounted hashes
   and denial gates. Never roll back money or database history. Keep failure
   candidates and audit journal. Resume old schedules only after parent confirms
   no ambiguous provider outcome; otherwise retain the stopped state for recovery.
9. Success remains public read-only. Parent separately reviews background
   resumption and any later public mutation activation using a new additive
   source-verified upgrade-chain seal referencing the original r8 seal. Existing
   r8 validators will reject changed source/artifact hashes: that is an unresolved
   integration gate, not permission to rewrite those validators or their pins.

## Remaining parent gates

Actual old artifacts/source closures are unavailable in this local sidecar.
No exact-predecessor contract can be sealed from historical constants alone.
Parent must supply the live baseline, complete closure comparison, integrated
Next archive, reviewed successor receipt/container label design, executable
transaction adapter with failure-injection tests, independent additive seal,
and real read-only post-check evidence. Bound every operation to the unchanged
deadline and original NGN 100 budget/principal. No payment outcome is claimed.

Focused local tests: `node --test
tools/staging/prefunded-card/provider-pending-upgrade/*.test.mjs`.
