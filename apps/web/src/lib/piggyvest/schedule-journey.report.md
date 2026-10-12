# Schedule customer journey — READY FOR PARENT REVIEW

Local-only, 2026-09-12. No deployment or provider validation claimed.

## Connections

- Shared strict `piggyvest-schedule-review` protocol mirrors the existing authenticated `/schedule` handler. Private actor/scope/token/proposal fields are rejected, not stripped from client requests.
- `createPiggyvestScheduleClient` reuses the common bounded customer request transport. `createPiggyvestScheduleClientBinding` connects actual GET/POST and operation readback to the controller. CSRF bootstrap/cookie ownership stays with the existing transport caller.
- Web `schedule-binding.tsx` and native `PiggyvestScheduleBinding.tsx` display plain terms, explicit version-bound resume proposal consent, pause, uncertainty and historical recovery. Screen owners integrate the optional bindings and reciprocal live compatibility gates.
- Refresh reads the original pending operation, then commits server-owned `observe`; historical receipts never replace current state. Unknown outcomes do not automatically retry. Callers retain `getPendingOperationId()` for reconstruction through `recoveryOperationId` after reload; no financial authority is stored in the browser.
- Pure subscription snapshots, isolated observer exceptions, source/session replacement, render-time callback replacement and post-CSRF guards are covered. The server independently verifies current actor, version, source token and policy under existing locks.

## Evidence

- `pnpm --filter @baci/shared test src/contracts/piggyvest-schedule-review.test.ts src/lib/piggyvest-schedule-client.test.ts src/lib/piggyvest-schedule-client-binding.test.ts src/lib/piggyvest-schedule-controller.test.ts`: 21 passed.
- `pnpm --filter @baci/web test src/components/storefront/piggyvest-savings/schedule-binding.test.tsx`: 5 passed.
- `pnpm --filter @baci/mobile-storefront exec jest --runInBand components/wallet/savings/PiggyvestScheduleBinding.test.tsx`: 4 passed. Two prior runs failed test-handler selection; corrected without changing runtime behavior.
- Exact regression RED: retained same-source consent after paused version advanced resolved rather than rejecting. GREEN: required displayed-version proof rejects it before submission. Native retained callback independently passes.
- `bash tools/test/schedule-journey-local.test.sh`: exit 0, twice. Final pre-expiry 6, expired 3, restart 4 phase-cases; includes three new rendered web/shared-client/actual-loopback-HTTP/CSRF/restricted-PG cases and eight existing observed ledger/schedule lock races.
- Connected sequence: observe v1, explicit resume v2, committed pause with lost acknowledgement v3, recovery/observe v4, fresh explicit resume v5, expired safe observe v6, restart safe observe v7. Historical resume receipt remains v5 and non-authorizing. Five pre-expiry writes use five distinct operation IDs; no duplicate pause dispatch.
- Synthetic screen/auth fixture explicitly labelled; SQL and HTTP are real and local. Existing standard executor/catalog used. No provider transport or financial operation is added.
- Scoped Biome and shared typecheck pass. Parent owns final broad root checks; no new root mass run here.

## Boundaries

Post-integration regression: a temporary sibling busy guard must not invalidate schedule identity. Lifetime/view guards and transient dispatch compatibility are now separate, with a direct regression and combined web/native coverage. The final post-fix actual harness again exits 0 at `/tmp/piggy-schedule-compat-final.log`; 13 phase-cases and eight observed lock races are unchanged. No SQL change was needed.

Cadence, provider scheduling/collection and collection-owner handover remain unavailable: no accepted cadence/mandate or safe in-flight handover contract is invented. Persisted resume consent is a proposal, not permission to debit; pause does not assert a provider mandate was stopped. Existing Paystack paths remain unchanged.

No SQL changed. Frozen schedule hashes remain:

- 165000: `e47b30078e23e9f0e5ce42397df16b3aef186c4c0cab2cc21b9cbe084caa56ce`
- 165100: `3149aa40018c69a888e627f80ff5d73680ff83c5c1304e8839076075eddf882f`
