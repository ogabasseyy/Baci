# Protected offer shared/web display

## Scope

The shared public contract is extracted from the existing protected-offer schema, with an approved web compatibility re-export. New bounded client/controller files reuse the existing customer request transport. `protected-offer-binding.tsx` is optionally connected through `SavingsScreenProps.protectedOfferBinding`; absence or failure does not gate checkout, funding or the existing purchase confirmation.

The display requires no extra acknowledgement or acceptance. It describes a device-price-only promise, not stock reservation, affordability, paid order or fulfilment. It displays the exact original seven-day window and server-observed status/time. Expiry messaging preserves the original guarantee and requires existing server checkout recalculation, not a browser-clock decision or automatic collection restart.

## Identity and recovery

- Source session, goal, immutable revision, terms and condition must match; changed sources invalidate the display and late callbacks.
- The first load can publish once, then retrieves scoped server observation. Every later load is GET only, including after publication response loss.
- Same-price deduplication retains the original offer ID and original clock. The public observation includes `requestedOfferId`; recovery of a committed alias can return the canonical original receipt without renewing the offer window.
- Failed refresh clears the prior active observation. Retained receipt is expressly historical, not current pricing authority.
- Server observation states are `active`, `expired`, or `historical`; `funds` remains `requires_checkout_review`. No frontend time, balance or price is accepted as authority. Public schemas reject private fields and additional financial authority.

## Validation

- Shared contract/client/controller: 12 focused tests passed. Covers exact seven days, private-field rejection, alias recovery, stable deduplication, source/revision mismatch, server-observed expiry despite a changed browser clock, and clearing cached active state. Valid uppercase request UUIDs normalize before server scope validation; its exact RED is retained in `/tmp/protected-offer-uuid-red.log`, final GREEN in `/tmp/protected-offer-shared-green.log`.
- Final web display and web compatibility-schema suites: four tests passed, including continued purchase review with a null offer binding. The existing SavingsScreen suite also passed all 26 tests with the new optional display.
- Direct web and shared typechecks passed. Scoped Biome checked 12 files with no errors.
- Fermat's `bash tools/test/protected-offer-local.sh` log was inspected at `/tmp/protected-offer-local.log`: three observed publication/replay/reservation lock races passed, followed by one actual shared-client HTTP/restricted-PostgreSQL test and one restart test. Source inspection confirms real signed-CSRF bootstrap, shared publish/status calls, same-price alias response-loss recovery, uppercase request coverage and existing checkout honoring the offer after a catalogue increase. This is Fermat-run synthetic evidence, not a provider or live-auth test.
- Backend migrations, handlers, server observation/alias implementation, SQL harness and integration tests remain Fermat-owned. No migration or provider operation is changed by this slice.
- Final backend rerun was inspected in `/tmp/fermat-protected-offer-final.log`: three lock races and the HTTP/PG test before and after restart passed at 22:39:13 and 22:39:17. Fermat confirmed the chained command exited zero, the disposable cluster was cleaned up, all three reviewer P2 findings were closed, and six SQL files were frozen with registration handed to Russell. These remain backend-owner confirmations, not a deployment or provider claim.

Status: shared/web implementation READY FOR PARENT REVIEW and frozen for this handoff. Hooke reported no additional shared/web §7 finding; the request-UUID normalization regression is fixed. Backend freeze is confirmed separately by Fermat; global registration remains parent-owned. Local synthetic evidence only; no native suite, browser acceptance, live authentication, provider call, notification, stock hold or deployment is claimed.
