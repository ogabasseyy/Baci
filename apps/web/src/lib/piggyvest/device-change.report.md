# Wallet-preserving device change — local implementation

Status: 180000–180600 FROZEN after final local harness and Hooke bounded source review (no confirmed P1/P2). Registration delegated to Russell. No deployment, provider certification or production activation is claimed.

## Connected API

`createPiggyvestDeviceChangeHandler(common & { termsDocument })` exports `quote`, `confirm`, `status`. The actual loopback runtime enables these only with `services.deviceChange: { enabled: true, termsDocument }`; absent configuration returns 503. Existing authenticated getUser-first, bounded JSON, CSRF, fixed-goal ownership, abort, timeout and redaction boundaries are reused. `/close-plan` GET/POST additionally composes Russell's actual handler only with `services.closure: { enabled: true }`.

- POST `/device-change/quote`: `{ goalId, quoteId, productId, variantId }`, nullable variant for genuinely nonvariant products. No client monetary, terms, actor or deadline fields. Returns `{ status: 'quote_available', quote, terms }`.
- Quote: exact `quoteId/revisionId/priorRevisionId/goalId`, `device: { productId, variantId, productName, variant, condition }`, integer internal `priceKobo`, nullable `durationMonths/maturesAt/graceExpiresAt`, `termsVersion/termsHash/expiresAt`. Terms come from enabled server-owned goal gate and matching configured full text/hash.
- POST `/device-change/confirm`: `{ goalId, operationId, accepted: true, quote }`. Receipt preserves reviewed quote except expiry, adds `status: 'device_changed'`, operation ID and literal `wallet/balances: 'unchanged'`, `collection: 'paused'`, `dispatch: 'disabled'`.
- GET `/device-change/status?goalId&operationId`: `{ status: 'historical', receipt }`. Historical receipt does not establish current selection or authorize a new purchase. Response loss requires readback with original operation ID.

`DEVICE_CHANGE_STATEMENTS`: `publishDeviceChange`, `confirmDeviceChange`, `readDeviceChange`, each seven parameters: integration, merchant, customer, goal, business, authenticated actor, JSON command (publish/confirm) or UUID operation (read). Exact statements have been registered by parent; only `piggyvest_staging_policy_writer` is admitted. No migration grants are seeded.

## Persistence and downstream behavior

- Immutable replacement/publication/receipt chain; original snapshot, consent and activation remain immutable. No second balance ledger, money write, new wallet or cancellation workaround.
- Same registry/binding/customer/goal locks as purchase/cancel. Reject active reservations, reversal, terminal/legacy state and incompatible intents. Exact replay checks current owner before returning original receipt, with no fresh effects.
- Actual public goal device projection changes atomically, capturing the real BEFORE UPDATE trigger's returned timestamp in the accepted revision. Canonical views/readers expose the exact current accepted revision. A→B→C preserves original activation date, calendar duration and maturity/grace deadline. Unactivated drafts have no fabricated deadline.
- All principal, eligible paid interest and pending liabilities remain in the same ledger. Existing mapping remains unchanged. Schedule proposals are cleared and versioned to paused; old receipts remain history.
- Purchase, cancellation, schedule, funding and activation readers use current revision views. New pricing requires an explicitly reviewed, exact revision-specific capability, disabled by default. No old fee/tax capability automatically carries forward. Existing publisher re-reads actual new catalog/variant/VAT/merchant/pickup/stock and rechecks sources. Missing capability blocks only that checkout path.
- Previously unactivated replacement drafts can activate at the real threshold using the newly confirmed price and existing selected duration. Original activation receipt replay retains its original price/date; it does not reactivate or extend the plan.

## Evidence

- Test-first SQL presence assertion RED; new runtime/schema tests initially absent-module RED. Actual route regression RED (404 rather than configured-disabled 503), then GREEN.
- `bash tools/test/device-change-local.sh`: GREEN. Disposable Unix-socket PostgreSQL, real restricted executor, synthetic authenticated RLS reader and actual localhost HTTP. Four observed lock waits cover purchase/cancel versus device change in both orders; exactly one incompatible operation wins. SQL covers exact variant/price, A→B→C, unchanged ledger/mapping/deadline, price/stock/consent staleness, ownership revocation, original activation/history replay, no inherited pricing capability, changed VAT/pickup sources, schedule consent invalidation and funded replacement draft activation/replay.
- Same harness runs actual HTTP quote→committed response loss→status→exact replay, current `/screen`, then actual `/purchase/quote` reading the new public goal/catalog. Missing exact capability returns 503; reviewed exact capability returns the new device/tax/pickup quote. One integration case passes before restart and one after PostgreSQL/listener restart (the opposite phase case intentionally skips). Log: `/tmp/device-change-local.log`.
- `pnpm exec vitest run src/lib/piggyvest/runtime-composition*.test.ts src/lib/piggyvest/device-change*.test.ts src/schemas/device-change.test.ts --maxWorkers=1` from apps/web: 39 passed, 5 opt-in tests skipped; 11 suites passed, 3 skipped. Device integration opt-in cases execute separately in the harness.
- Scoped Biome: nine owned runtime/test TS files clean. Strict TypeScript diagnostics filtered to owned device files: zero. Shell syntax checks pass. Runtime files remain below 300 lines.
- Russell independently reports current-180 + frozen-181 compatibility GREEN: replacement→old revision closure rejected→current revision closure; replacement→credit→new device activation→closure unavailable; closed replacement→activation rejected with no current activation. His final log is `/tmp/piggy-closure-joint-final.log`, not an independent PG rerun by this owner.

## Owned files

- `supabase/migrations/20260912180000_device_change_versions.sql`
- `supabase/migrations/20260912180100_device_change_publication.sql`
- `supabase/migrations/20260912180200_device_change_confirmation.sql`
- `supabase/migrations/20260912180300_device_change_canonical_read.sql`
- `supabase/migrations/20260912180400_device_change_pricing.sql`
- `supabase/migrations/20260912180500_device_change_operations.sql`
- `supabase/migrations/20260912180600_device_change_lifecycle_funding.sql`
- `apps/web/src/lib/piggyvest/device-change-handler.ts`, colocated test, `device-change-statements.ts`, colocated test, `device-change.integration.test.ts`, this report.
- `apps/web/src/schemas/device-change.ts` and test initially created here; compatibility shim ownership transferred to Descartes for shared public contract extraction. Do not concurrently edit.
- Narrow runtime composition methods/types/routes and colocated route regression.
- `tools/test/device-change-local.sh`, `device-change-fixture.sql`, `device-change.test.sql`, `device-change-negative.test.sql`, `device-change-draft.test.sql`, `device-change-race-fixture.sql`, `device-change-race.sh`, `device-change-race.test.sql`.

## Remaining local ownership / external contracts

Hooke final bounded source review is clean; frozen hashes sent to Russell for registry/planner registration. Parent owns broad gates. Descartes owns shared/web device-change controller/UI and Sartre native composition; protocol has been sent, no backend-only completion is represented as full journey completion. Tests use synthetic auth and fixture credits, not real Supabase login/provider balances. Provider settlement, refund, interest disposition and collection dispatch remain independently gated; this operation introduces none of those capabilities.

## Frozen SHA-256

```text
3b11dbf9a14815c4f916f8b3cf2ce75f4bb30bf32352cf27452b47ace933bc1e 20260912180000_device_change_versions.sql
a97500ea39369ba979fe3347ef3f350a597d35f9b8d6ff3988261cfb19eab462 20260912180100_device_change_publication.sql
b49c7d60c1912534a1ad81c69666078079b9e1c0a8b6ce2bdb2d150c0b4e5f12 20260912180200_device_change_confirmation.sql
fe2afd05709cfd6ef963c2d2cf4144c2fa3a05f5e170592d34e5503b4908a4c8 20260912180300_device_change_canonical_read.sql
f30293f2b70a239682522ba922f90539a60a21c6e98a2170436871f634c6190d 20260912180400_device_change_pricing.sql
609179e365704569762f53d0c70d89ddaeecf94b20d2767891f042c1ca9e216a 20260912180500_device_change_operations.sql
28ccf41a93f6fcbaf0455cf393c4992f349d8cb823cfea8e18b5b99fd9007dfc 20260912180600_device_change_lifecycle_funding.sql
```
