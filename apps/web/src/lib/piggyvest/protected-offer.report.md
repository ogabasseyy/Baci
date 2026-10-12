# Protected offer backend — local review

Status: READY FOR PARENT REVIEW. Six migrations 182000–182500 are frozen at the hashes below. Hooke's final bounded source review closed all three P2 findings with no remaining confirmed P1/P2; reviewer inspected owner PG/HTTP logs, not an independent PG rerun. No deployment or provider execution.

## Contract

- `createPiggyvestProtectedOfferHandler(common)` exports `publish(NextRequest)` and `status(NextRequest)` using the existing authenticated RLS context, bounded request handler, CSRF and restricted executor.
- Optional isolated runtime `services.protectedOffer: { enabled: true }`; absent configuration returns 503. No production route added.
- `POST /protected-offer/publish`: strict `{goalId, offerId}` UUID identifiers only. Returns `{status:'published', receipt}`. No price/terms/actor authority or separate acceptance.
- `GET /protected-offer/status?goalId&offerId`: `{status:'observed', requestedOfferId, receipt, observedAt, pricePromise:'active'|'expired'|'historical', funds:'requires_checkout_review'}`.
- Receipt: `{offerId,goalId,revisionId,device:{productId,variantId,condition},priceKobo,termsVersion,termsHash,startsAt,expiresAt,scope:'device_price_only',purchase:'requires_confirmation',dispatch:'disabled'}`.
- Same-price request B records an immutable alias to original publication A. Read/replay B returns A's unchanged window, even after a catalog rise or restart. `requestedOfferId` correlates B separately from canonical receipt A. UUID request normalization changes no immutable receipt bytes.
- Publication is the price promise; existing explicit purchase confirmation remains purchase consent. Lowest valid overlapping genuine publications feed actual checkout pricing. Copied checkout fields alone do not establish provenance. Reversal/reservation blocks spending, not the immutable promise. Existing stopped schedules remain stopped after publication.

## Files

New SQL in `supabase/migrations/`:

| File | SHA-256 |
| --- | --- |
| `20260912182000_protected_offer_publications.sql` | `8da9524405f3789d5bed641c6ba0c01eb0113dfb4284f8806ff4ab9498b46570` |
| `20260912182100_protected_offer_publish.sql` | `4166ce5b902e17929352e6934db28beaa59aea37f8b9ef92606a9283c6a1f89e` |
| `20260912182200_protected_offer_pricing.sql` | `0525d780cc2fb604adb164facb10e3eb811308e940c22a338d94cd0edbbccb5b` |
| `20260912182300_protected_offer_quote_provenance.sql` | `d47cec538bd4813215d3dc2c9accd1be7c5172d223d7e56bada24eed3b98bd49` |
| `20260912182400_protected_offer_catalog.sql` | `ee8f54c67405be717bf68d53f5c5a8927dbca5ff31267740ee5b841c419c0273` |
| `20260912182500_protected_offer_schedule.sql` | `58d06c17e91d18ec288e517ef30d43841ca493835c2e514dd0ff3a94e635df5a` |

New files under `apps/web/src/lib/piggyvest/`: `protected-offer-handler.ts`, `protected-offer-handler.test.ts`, `protected-offer-statements.ts`, `protected-offer-statements.test.ts`, `protected-offer.integration.test.ts`, this report.

Narrow existing runtime changes: `runtime-composition-routes.ts`, `runtime-composition-routes.test.ts`, `runtime-composition.constants.ts`, `runtime-composition.types.ts`.

New harness files under `tools/test/`: `protected-offer-local.sh`, `protected-offer-race.sh`, `protected-offer-setup.sql`, `protected-offer.test.sql`, `protected-offer-funds.test.sql`, `protected-offer-stopped.test.sql`, `protected-offer-typecheck.json`.

Schema `apps/web/src/schemas/protected-offer.ts` and its test were initially added here, then explicitly transferred to Descartes for shared contract extraction and compatibility re-export. Shared client/UI/barrels and statement/manifest registration are other owners' work, not claimed here.

## Evidence

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

- `bash tools/test/protected-offer-local.sh`: fresh Unix-socket-only PostgreSQL; actual catalog publications, lower overlap, immutable 168-hour window, exact expiry/current revision exclusion, pending interest exclusion, counterfeit provenance rejection, reversal retention, stopped/resume denial; three observed concurrent lock waits. Actual loopback HTTP → shared client → handler → standard registered restricted PG executor passes before and after PostgreSQL restart.
- Connected regression: A publication → same-price B committed but ACK lost → catalog rise → GET B/replay B returns A's original receipt/window. Alphabetic uppercase goal/alias GET and POST pass actual HTTP. Log `/tmp/fermat-protected-offer-final.log`.
- Exact RED captured before fixes: alias HTTP lookup failed in `/tmp/protected-offer-alias-red.log`; sticky stopped changed to paused in `/tmp/protected-offer-stopped-red.log`. UUID unit RED also reproduced before shared request normalization. Earlier catalog-rise RED was confirmed-funds-insufficient; copied-provenance and schedule-price assertions separately failed before their append-only corrections.
- `pnpm --dir apps/web exec vitest run src/lib/piggyvest/protected-offer-handler.test.ts src/lib/piggyvest/protected-offer-statements.test.ts src/lib/piggyvest/runtime-composition-routes.test.ts src/schemas/protected-offer.test.ts`: 4 suites, 10 tests pass.
- `pnpm exec tsc -p tools/test/protected-offer-typecheck.json`: pass. Scoped Biome checks: 10 owned files clean. Shell syntax checks pass. New runtime TS/SQL files remain below 300 lines.

## Boundaries

### Broad-run follow-up

Parent's `/private/tmp/piggy-web-isolated-full.log` records two protected-offer failures: uppercase goal/offer returned 403 and alias readback returned unavailable. That broad run remains failed; this scoped rerun does not replace it. On current sources, the exact four-suite command above passed all 10 tests at 22:45:30, including both regressions; exit 0, log `/tmp/fermat-protected-offer-focused-current.log`. No source fix or frozen SQL change was needed for this rerun. Other broad-run failures and a fresh full-suite gate remain parent-owned.

Synthetic authentication/RLS fixtures are not production login evidence. Local ledger fixtures are not provider funds or interest eligibility evidence. No provider dispatch, automatic collection restart, notification, physical stock reservation, money transfer, tax assumption or production activation is added. Existing fee/tax/pickup capability checks still apply at checkout. Historical/active price observation does not authorize spending; current verified funds, stock/variant, maturity, fees, CSRF and explicit purchase confirmation are rechecked separately.

No frozen pre-182 SQL, global executor catalog, manifests, environments, proxy, production routes, credentials, deployment or external data changed by this slice. Russell owns final manifest/planner registration; parent owns guarded full-schema/root checks. This is not a full product or live-readiness claim.
