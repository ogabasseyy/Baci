# Disposable signed PiggyVest interest contract E2E

This is an executable **synthetic, source-contract integration test**, not an
acceptance-boolean checklist, provider delivery, web payment, native build or
push send. It loads the supplied payout fixture without reserializing its first
delivery. Synthetic test-only HMAC/AES material is injected directly; no real
credentials, env files, provider endpoints or EAS services are read or changed.

## Run

From `/Users/mac/Baci-worktrees/cursor-savings-phase1`:

```sh
pnpm exec node --test --test-concurrency=1 tools/staging/interest-bridge/contract-e2e/*.test.mjs
pnpm exec node tools/staging/interest-bridge/contract-e2e/run.mjs
pnpm exec biome check tools/staging/interest-bridge/contract-e2e
```

Requires the already installed PostgreSQL 18 binaries at
`/opt/homebrew/opt/postgresql@18/bin`, existing pnpm dependencies and the receiving
worktree `/Users/mac/.codex/worktrees/0d77/Baci-app`. No installs/builds are run.
Keep test concurrency at one on this disk-constrained host. The harness refuses
below 128 MiB free. It creates a uniquely owned `/private/tmp/baci-contract-e2e-*`
cluster, uses one-MiB WAL segments, binds **no TCP address**, ignores inherited
PG credentials/targets and stops/removes only its own cluster in `finally`.
Server query/error-statement logging is disabled. Failures withhold SQL output.
No other worktree or temporary directory is cleaned.

## Actual contracts exercised

- Receiver `intake-handler.ts` validates raw-byte SHA-512 HMAC and seals the
  exact bytes with AES-256-GCM. `intake-persist.ts` uses its real strict schemas
  and REST request shape; an in-process, fixed-RPC transport replaces HTTP only.
- Receiver `ingest-storage.sql`, `replay-storage.sql`,
  `replay-runtime-storage.sql` and `receipt-signature-storage.sql` install real
  encrypted receipt, original-signature, lease, retry and quarantine functions.
  Restricted NOLOGIN receipt roles retain actual RLS and fenced RPC boundaries.
- Actual `createDurableReplayAdapters`, `createReplayWorker`, authenticated
  decryption, payout/accrual parsers and `createInterestReplay` /
  `createAccrualReplay` execute their source SQL against real PostgreSQL.
  Payout HMAC validation happens at intake; accrual replay additionally rechecks
  the stored original signature and preserves the original decimal lexeme.
- Fourteen canonical migrations implement the actual ledger, eligibility
  policy/allocation, receipt application, notification and authenticated read
  projections. Mobile inbox/Earnings schemas and the real goal projection
  consume those RPC outputs; principal stays 10,000 kobo and displayed confirmed
  savings becomes 107.33 naira from 100.00 plus the 733-kobo net credit.

Only the runtime-storage **physical deployment guard** is rebound in memory to
the just-created cluster's `pg_control_system()` identifier. The adapter refuses
the deployed pin, missing/multiple pin occurrences and missing owner guard.
Existing files/migrations are never edited; functional SQL stays unchanged.
The scratch database combines receipt/application schemas to test transactions
without Docker/PostgREST. It is not a deployed network/topology or TLS test.

`fixture.sql` provides minimal synthetic ownership tables, roles, exact policy
and 10,000-kobo opening principal. Its colocated SQL regression verifies the
socket-only target, ownership, unpaid opening and actual privilege boundaries.
These fixtures are not live eligibility evidence or new sandbox prefunding.
Injected receipt-commit failure, acknowledgement loss and lease expiry are
scratch-only fault simulations. They do not edit the replay implementation.

## Required observations

The ten executable scenarios reject bad HMAC/tampered bytes before persistence;
record `406.8493150684931234` kobo as nonspendable accrual without credit;
refuse a fresh foreign wallet as `deferred`; roll back allocation/credit/notice
on receipt failure; apply gross814/tax81/net733 exactly once; recover the same
credit after PostgreSQL restart and lost acknowledgement; keep eight concurrent
duplicate SQL calls and alternate event delivery duplicate-safe; quarantine a
foreign-wallet collision as `conflict`; and prove authenticated net-only inbox,
read-marker and per-goal Earnings projection. Zero push deliveries are created.

The default CLI emits only fixed check names, economic counts and loaded-source
fingerprints. It omits source-entry paths and never prints payloads, signatures,
keys, notification bodies or arbitrary errors. `providerPayoutVerified`,
`deviceReceiptVerified`, `liveWritesPerformed` and `pushSendPerformed` stay false.

## Device-free checks and remaining external gate

Existing offline config/acceptance regressions and mobile Jest suites can check
fail-closed native identity/build selection, production manifest parity, inbox
schema/render behavior, scope-specific wallet invalidation, goal/Earnings
refresh, warm/cold notification navigation and sample-preview isolation without
EAS authentication or a connected phone. Default preflight/acceptance must still
refuse the absent approved native staging identity. No acceptance form is proof
of an actual artifact or device.

The unavoidable physical gate is owner-authenticated inventory of a **separate
approved staging EAS project**, real approved iOS/Android identities, matching
signing/APNs/FCM and an actual reviewed development-client artifact installed on
a connected physical phone, followed by real notification permission, genuine
native token registration and foreground/background/cold-start receipt with
scoped wallet/goal refresh. Existing production project/native IDs, fabricated
tokens, simulated builds or synthetic payout fixtures cannot satisfy that gate.
Parent exclusively owns live changes and any eventual provider/payment proof.
