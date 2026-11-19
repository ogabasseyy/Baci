# Main update and cart verification — 25 October 2026

Working checkout: `/Users/mac/Downloads/Oxygen-transfer-2026-10-23/project`.
Branch: `codex/oxygen-main-cart-performance`.
Main base: `def9f0b7a52abf1367cec63b75f0c315c33925e0`.
Previous base: `68903f4628694115857b1641aaf85f43f58a7dcf`.

## Preservation

Full verified pre-update working files and original Git metadata are in
`/Users/mac/Downloads/Oxygen-transfer-2026-10-23/backups/before-main-20261025T192611Z`.
The retained `stash@{0}` is labelled `oxygen-preserved-before-main-20261025`.
All 446 files saved in its untracked parent were restored. The cart route test
collided with a new main file and was reconciled into the main test; the
original remains in the backup and stash. All 172 intent-to-add entries were
restored. The original staged diff was empty and remains empty. Existing
tracked deletions remain preserved, including generated logs and native local
files. No commit, push, deployment or production migration was performed.

## Integration and performance

Ported Oxygen checkout slots, isolated local attempt identity, authenticated
preflight and order handoff into main's extracted checkout modules. Main's
REDVAULT and other payment providers remain available under their existing
contracts. The exact previously authorized Hydrogen iframe host is now in
main's extracted CSP module. Legacy local place-order source remains saved;
the active path uses main's extracted order submission.

Cart now reads dynamic route data within Suspense, avoiding Next's blocking
navigation warning. It uses complete public merchant VAT settings directly,
with the existing streamed live-read fallback for incomplete snapshots.
Server order pricing remains authoritative. No extra animation library,
global font, homepage hero, or cart hydration store changes were added.

Cart variant chips are opt-in on the full cart only; other consumers retain
labelled variant details. An empty extras area is omitted. The synthetic
merchant public snapshot has no shipping_insurance_enabled setting, so the
unselected protection offer stays hidden. No merchant setting or fee changed.

## Validation

- New cart test failed before the redundant-query fix and passed after it.
- Cart route tests: four pass, including unresolved params streaming and VAT fallback.
- Checkout/cart hydration targeted group: 143 pass; screen/submission integration group: 47 pass (overlapping dispatch coverage).
- Additional homepage LCP/preload and cart/wallet regression group: 19 pass.
- Cart display group: 27 pass.
- Web TypeScript check passes. Biome passes for the route and scoped changed UI.
- Broad Oxygen suite: 1092 pass, three pre-existing failures in OxygenOfferCompletion and OxygenSavedPlans. Those UI source files are unchanged from the saved transfer.
- CodeRabbit update review completed with two test fixture findings; both corrected and the wallet-funded tests passed. Latest small cart chip styling was added after that review.
- Actual browser cart -> checkout -> cart succeeded without refresh; quantity two and total 396000 preserved. Cart warm HTTP response approximately 0.8s locally. Dev compilation is slower; these are not production CWV measurements.

Portable runtime is running on localhost:3440. Its commerce import adapter was
updated for main's new calculate-order-totals import. Generic activation and
settlement remain disabled. No booking, OTP, approval, cancellation, activation
or settlement was triggered by this update. Never repeat the prior terminal
one-use activation trial or older indeterminate booking attempts.
