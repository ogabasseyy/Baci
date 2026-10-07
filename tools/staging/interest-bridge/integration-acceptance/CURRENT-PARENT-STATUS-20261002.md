# Parent integration status — 2026-10-02

This is a current parent observation, not a replacement for the sealed historical
reporter inputs or a full integration/production acceptance claim.

## Independently observed

- The one approved test-card collection is verified by Paystack. Its existing
  operation is `ff561046-58e7-428d-9163-f6e60b0dab65`; no second payment was started.
- PiggyVest authenticated transaction verification reports that the existing
  10,000-kobo company-to-plan transfer succeeded. The destination provider wallet
  holds 10,000 kobo and the company source wallet holds zero.
- The company sandbox allowance remains **10,000 kobo total**, not per plan.
  No additional allowance or transfer is authorized by this report.
- The original outflow webhook reached the receiver. Receipt
  `0f9938ae-8551-4e2e-8816-853e0231b2c3` has its original stored provider signature.
  The parent checked original plaintext SHA-256, AES-GCM authenticated storage
  and HMAC-SHA512 using the existing protected configuration. No signature or
  financial event was manufactured.
- The receipt is not processed: `quarantined`, five observed attempts, no
  durable conflict/poison-quarantine row. Its stored retry deadline is
  `2026-10-03T07:45:26.302325Z`; no backoff, claim, lease or receipt status was
  reset to accelerate processing.
- The app operation remains collection `verified_success`, transfer
  `dispatching`, projection `unapplied`. Its new goal has not yet been credited
  in the app; provider funding alone is not app completion.
- The evidence-only gateway recovery is applied. Fresh private health, firewall
  and Docker inventory passed, the new startup evidence is installed, and the
  gateway remains active after its diagnostic tracer detached. All six public
  unauthenticated probes returned 401. The binding, unit, installed source graph,
  roles and deadline remain unchanged.
- Fresh authenticated goals, wallet, notifications and checkout GETs all returned
  200 using the actual `savings-synthetic` merchant slug. The old goal still shows
  NGN100, the new goal NGN0, and checkout admission is disabled with a zero
  additional allowance. The earlier wallet 404 used the wrong probe slug.
- Background, snapshot and notifications schedules were stopped for bounded
  reconciliation; their services were observed inactive with exit status zero.
  Deadline timers were not extended or disabled.

## Exact native contract correction

The authentic event uses category `wallet_transfer`, completed FAAS source and
destination identifiers, and null event fee. Existing replay enrollment accepted
only `wallet-transfer`; the older verifier expected a flat TSQ response.

The fresh authenticated TSQ uses `successful`, public wallet identifiers, the
business as `customer_id`, and zero fee. Both wallet GETs and the API-customer
wallet list expose `faas_wallet_identifier`, not `wallet_identifier`.

The signed event's top-level `pvb_reference` is an event-specific identifier,
distinct from the native TSQ transaction ID. The original event's
`third_party_reference`/`initiator_reference` match that native transaction ID;
its `reference`/`internal_reference` match the TSQ reference. The top-level
`pvb_third_party_reference` matches the app transfer reference. These namespaces
must not be substituted for one another or populated from an expected claim.

The receiver fix requires original signature validation, all these correlations,
authenticated public/FAAS wallet pairs, business/currency checks, the independently
scoped destination mapping and matching customer-wallet listing. It emits the
existing SQL category only after validating the native shape. Outflow ingestion
records evidence; it must not directly project a bank inflow.

## Remaining completion work

- The reviewed replay factory is installed and its bounded start is verified.
  Preserve the original receipt's scheduled retry; do not initiate another
  collection or transfer while awaiting native evidence.
- Prove stored evidence, existing fenced completion and exactly one app credit,
  then authenticated wallet/goal/checkout/inbox readbacks. Resume safe schedules.
- The additive first-card claim-boundary correction is now installed. A fresh
  root rollback rehearsal and independently restored snapshot passed for 376
  permanent relations, including all eight materialized views. The reviewed
  commit changes only two function bodies; all financial rows, permanent
  metadata, privileges and principal remain unchanged. Audit files are retained
  at `/root/baci-financial-owner.2ynkl9kc/claim-boundary-r3-9ase5n50`.
- Real provider interest payout remains distinct from the tested synthetic
  gross814/tax81/net733 fixture. The new interest-enabled wallet does not establish
  a verified payout namespace policy, real payout or delivered notification.
- Separate native staging signing/EAS identity and physical-phone push acceptance
  remain outstanding. Production identity must not be reused as a shortcut.

Fresh broad lint/typecheck still fail in unrelated mobile-storefront files;
web and tools-worker typechecks pass. Owned focused regression results must be
reported separately from these broad failures and any provider/device evidence.

Until the remaining checks pass, tell PiggyVest that sandbox collection and
provider wallet funding are verified, but application reconciliation and final
integration acceptance are still in progress. Do not say everything is complete.

## Reviewed factory build

The parent independently reran 128 signed-event tests and 24 build-kit tests.
All passed. The parent also verified all 30 original application sources against
the installed r8 factory inventory before compiling the exact six reviewed
overlays; the new graph contains 32 application sources and 151 total inputs.
The 190 content-addressed captures and artifact verifier pass independently.

- Factory SHA256: `b73f5ed97441b8e1941badc340eefee787c43d300bdf033c46174e4e79bab9c4`.
- Manifest SHA256: `b0ac46778810cf5769dbd6c56c52df30ca845dc6a90e4245f1949b5826fc5e11`.
- Private local artifact: `/private/tmp/pvb-replay-native.aE98Ku/artifact`.
- The factory is deployed in
  `/opt/baci-prefunded-replay-generations/native-m_xv_71j`, with generation seal
  `42966bb33ae5c84223cb56a4de17da442f8ce22c38f003fbcc447e39e0a85068`.
- Guarded read-only check, stopped replacement and separate bounded-start
  reports pass. This is deployment evidence, not receipt processing or app-credit
  proof. The corrected replay is running under its unchanged Oct 6 deadline.

Gateway is active with fresh evidence SHA256
`c1ad9ba021842fc876094af62f9dd6f463de2d7aeb83337eaa821c3ae59f5ae4`.
Financial schedules remain paused pending native signed evidence and fenced credit. The
original replay container is stopped and retained as
`pvb-staging-replay-prefunded-prior-b9b35efd2ffb`; the corrected replacement uses
the original live name. Deadline units and the original r8 seal remain unchanged.

## October 3 boundary diagnosis

The receipt's natural fifth attempt resolved as `worker retryable`.
There is no target provider-evidence row. The older verified bank-inflow evidence
row is unrelated and must not be counted as this transfer's evidence.

- Installed daemon decryption with its actual configured key preserves the
  original plaintext digest. Its actual dispatch-to-enrollment call returns
  `enrolled`. A mocked signature callback reaches a deliberately blocked replay;
  this is not proof of successful live claim-fenced signature access.
- Installed private transport and Supabase RPC handling return the expected
  HTTP400/SQLSTATE22023 denial for a null claim. This negative probe proves
  routing, not a valid leased signature read.
- The signature reader's owner has the existing narrow UPDATE-column grant
  required for row locking; no broader table UPDATE grant is needed. Its actual
  RLS-scoped receipt and original-signature visibility both return one row.
  No grant, ownership or policy change was made.
- The exact factory's original initial deferred observation returns `stored`
  in a rollback-only SQL rehearsal under `prefunded_evidence`. The actual bundled
  TLS executor also returns SELECT/`stored` and reaches its COMMIT boundary;
  that COMMIT was intercepted in the diagnostic process, replaced with awaited
  ROLLBACK and followed by a planned exception. No commit success was fabricated.
  Existing protected logical-state snapshots match before and afterward.
- These rehearsals do not process the receipt or credit the goal. No provider
  fetch, payment, transfer, original-claim reset or additional budget was used.
  Live signature handoff and the complete natural attempt remain unconfirmed.
- PostgreSQL error logging is configured at `panic`; absence of a Docker error
  line is not evidence that no ordinary SQL error occurred. Diagnostic conclusions
  above rely on direct results, not missing server logs.

Preserve the next natural retry at `2026-10-03T07:45:26.302325Z` and the fixed
October 6 deadline. Application reconciliation, genuine provider interest and
physical-device delivery acceptance are still separate unfinished gates.

## October 3 confirmed competing claimant

The failed fifth attempt was claimed by the separate paid-interest-only worker,
not by the corrected native funding worker. Both used the same generic receipt
claim RPC. The interest worker had no prefunded factory and could not dispatch
this native outflow; post-claim rejection consumed its attempt and backoff.

- `baci-interest-replay` logged claimed1/retryable1/resolutionFailures0 at
  `2026-10-02T23:45:26.325106879Z`, matching the receipt's fifth resolution.
- `pvb-staging-replay-prefunded` logged claimed0 at `23:44:44.717571588Z`
  and `23:45:46.610235931Z`. Its installed correction did not process that attempt.
- Both daemon files have SHA256
  `02420ef54fe4061cb676ae01003acf4ed9c9280d22a1b3ca0d05e94bd9fe1457`.
  The interest configuration uses `prefunded_treasury_operator` without a
  prefunded factory; the native configuration has that factory without a
  financial-database dispatcher. Neither alone is capability-complete.
- With zero processing receipts, the parent stopped only the existing
  `baci-interest-replay.service`. Its container stopped; the native funding
  container remained running. Receipt state, financial state, source and unit
  hashes, and the interest worker's active October 6 deadline timer were checked
  before and afterward. No claim, backoff, lease, payment or transfer was changed.
- Containment audit:
  `/root/baci-financial-owner.2ynkl9kc/competing-replay-contained-669665edcf75455f849fd06bf1d93da2.json`.

Keep the conflicting worker stopped. A durable integration must use one
capability-complete claimant with separate restricted executors, or partition
claims before acquisition using authenticated immutable receipt-kind provenance.
Post-claim filtering is insufficient. Do not restart two generic claimants or
remove mode guards as a shortcut. Containment is not receipt processing, app
credit, real interest delivery or final integration acceptance.
