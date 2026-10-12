# After genuine native transfer evidence: bounded owner checklist

Local source review only, 2026-10-02. Nothing here has run on the VPS. Parent
executes reviewed reads and owns any later worker activation. No new factory,
payment, transfer, provider POST, SQL authority edit, replay enrollment, lease
reset, backoff edit, retirement edit or deadline extension is authorized.

## Fixed scope and order

- Event `01M3YP771123DWC9Y8Y4814Z8Y`; original signed receipt
  `0f9938ae-8551-4e2e-8816-853e0231b2c3`. Parent reports attempt 4, next eligible
  `2026-10-02T23:44:48.187325Z`. Wait for the existing replay's normal eligibility;
  no acceleration. Enrollment, a heartbeat or a processed receipt alone is not
  verified transfer evidence. Do not print raw body, ciphertext or signature.
- Operation/intent `ff561046-58e7-428d-9163-f6e60b0dab65`, new goal
  `9f01153c-1589-4dde-b9aa-8f644a846832`, amount **10000 kobo = NGN100**.
- Old goal `430314fd-cd8b-4579-98d4-e9f345713dd6` remains **10000 kobo**;
  retired operation/intent `d8bcf921-61b3-4647-90e2-5648e4d6967d` remains unchanged.
- Integration `d91d9e87-8e0d-44de-9b84-1e1d709633d2`; treasury binding
  `ffffcb16-2e95-5cff-a591-e9cc81cf5f57`. The company budget stays **10000 kobo**:
  before completion reserved/consumed = **10000/0**, afterward **0/10000**.
- Fixed deadline **2026-10-06T15:59:10Z**. Stop financial execution at expiry;
  read-only proof can still be collected afterward. Original r8 seal, retained
  container, immutable generation/release pins and existing deadline units stay
  untouched. This document is not added to or substituted into their seals.

## Exact read-only application snapshot

Run the block in the existing root terminal using
`/usr/bin/docker --host=unix:///var/run/docker.sock exec -i baci-isolated-savings-db-1 /usr/bin/psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres`.
Capture once after evidence is verified, before any completion pass, and again
after each eligible pass. Store results in the parent's private audit directory.
No `claim_*`, `read_transfer_evidence`, `complete_*`, `project` or other locking/
writer RPC belongs in this read-only transaction.

```sql
\set operation ff561046-58e7-428d-9163-f6e60b0dab65
\set goal 9f01153c-1589-4dde-b9aa-8f644a846832
\set old_goal 430314fd-cd8b-4579-98d4-e9f345713dd6
\set event 01M3YP771123DWC9Y8Y4814Z8Y
\set integration d91d9e87-8e0d-44de-9b84-1e1d709633d2
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='3s';
DO $identity$ BEGIN
  IF current_database()<>'postgres' OR session_user<>'postgres'
    OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
  THEN RAISE EXCEPTION 'application identity refused'; END IF;
END $identity$;
SELECT clock_timestamp() AS observed_at, current_setting('transaction_read_only') AS read_only;
SELECT evidence.event_id,evidence.fingerprint,evidence.conflicted,
  evidence.observation->>'status' AS status,evidence.observation->>'kind' AS kind,
  evidence.observation->>'eventType' AS event_type,
  evidence.observation->>'eventCategory' AS event_category,
  evidence.observation->>'providerTransactionId' AS provider_transaction_id,
  evidence.observation->>'reference' AS reference,evidence.observation->'references' AS references,
  evidence.observation->>'amountKobo' AS amount_kobo,evidence.observation->>'currency' AS currency,
  evidence.observation->'feeKobo' AS fee_kobo,
  evidence.business_id=treasury.expected_business_id AS business_matches,
  evidence.observation->>'reference'=operation.transfer_reference AS reference_matches,
  evidence.observation->>'sourceWalletId'=treasury.source_wallet_id AS source_matches,
  evidence.observation->>'destinationWalletId'=operation.destination_wallet_id AS destination_matches,
  evidence.observation->>'destinationCustomerId'=operation.destination_customer_id AS customer_matches,
  mapping.provider_wallet_id=operation.destination_wallet_id AS mapping_wallet_matches,
  mapping.provider_customer_id=operation.destination_customer_id AS mapping_customer_matches
FROM prefunded_card.provider_evidence evidence
JOIN prefunded_card.operations operation ON operation.id=:'operation'::uuid
  AND operation.integration_id=evidence.integration_id
JOIN prefunded_card.treasury_bindings treasury ON treasury.id=operation.treasury_binding_id
JOIN piggyvest_staging.wallet_goal_mappings mapping ON mapping.integration_id=operation.integration_id
  AND mapping.goal_id=operation.goal_id AND mapping.merchant_id=operation.merchant_id
  AND mapping.customer_id=operation.customer_id
WHERE evidence.integration_id=:'integration'::uuid
  AND (evidence.event_id=:'event' OR (evidence.observation->'references') ? operation.transfer_reference);
SELECT event_id,operation_id,already_applied,recorded_at FROM prefunded_card.evidence_conflicts
WHERE integration_id=:'integration'::uuid AND (event_id=:'event' OR operation_id=:'operation'::uuid);
SELECT operation.id,operation.goal_id,operation.amount_kobo,operation.currency,operation.checkout_retired,
  operation.collection_status,operation.transfer_status,operation.projection_status,
  operation.collection_provider_transaction_id,operation.transfer_provider_transaction_id,
  operation.transfer_attempted_at,operation.verification_fence,
  operation.verification_token IS NOT NULL AS verification_leased,operation.verification_lease_expires_at,
  intent.phase,intent.verified_collection IS NOT NULL AS collection_proof_present,intent.expires_at,
  queue.available_at,queue.attempts,queue.finished_at,
  queue.claim_token IS NOT NULL AS dispatch_leased,queue.lease_expires_at
FROM prefunded_card.operations operation JOIN prefunded_card.checkout_intents intent
  ON intent.operation_id=operation.id LEFT JOIN prefunded_card.dispatch_queue queue ON queue.operation_id=operation.id
WHERE operation.id=:'operation'::uuid AND operation.goal_id=:'goal'::uuid;
SELECT operation.id,operation.collection_status,operation.transfer_status,operation.projection_status,
  operation.checkout_retired,intent.phase,intent.verified_collection IS NOT NULL AS collection_proof_present,
  queue.available_at,queue.lease_expires_at
FROM prefunded_card.operations operation JOIN prefunded_card.dispatch_queue queue ON queue.operation_id=operation.id
LEFT JOIN prefunded_card.checkout_intents intent ON intent.operation_id=operation.id
WHERE operation.integration_id=:'integration'::uuid AND queue.finished_at IS NULL;
SELECT treasury.id,treasury.enabled,treasury.verified_available_kobo,treasury.reserved_kobo,treasury.consumed_kobo,
  treasury.verified_at,identity.opening_available_kobo,
  (SELECT coalesce(sum(amount_kobo),0) FROM prefunded_card.treasury_replenishments
    WHERE treasury_binding_id=treasury.id) AS replenished_kobo,
  treasury.reserved_kobo+treasury.consumed_kobo<=treasury.verified_available_kobo AS within_cap
FROM prefunded_card.treasury_bindings treasury JOIN prefunded_card.treasury_identities identity
  ON identity.treasury_binding_id=treasury.id WHERE treasury.id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57';
SELECT goal.id,goal.current_amount*100 AS displayed_principal_kobo,goal.target_amount*100 AS target_kobo,
  goal.status,goal.completed_at,
  (SELECT coalesce(sum(posting.amount_kobo),0) FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations entry ON entry.id=posting.operation_id
    WHERE entry.goal_id=goal.id AND entry.integration_id=:'integration'::uuid
      AND posting.account='principal') AS canonical_principal_kobo
FROM public.customer_savings_goals goal WHERE goal.id IN (:'goal'::uuid,:'old_goal'::uuid);
SELECT (SELECT count(*) FROM prefunded_card.projections WHERE operation_id=:'operation'::uuid) AS projections,
  (SELECT count(*) FROM piggyvest_savings_ledger.operations WHERE id=:'operation'::uuid
    AND goal_id=:'goal'::uuid AND integration_id=:'integration'::uuid
    AND evidence_id='pvb-card:'||:'operation' AND command->>'kind'='credit_principal') AS ledger_operations,
  (SELECT count(*) FROM public.customer_savings_contributions WHERE goal_id=:'goal'::uuid
    AND idempotency_key='pvb-card:'||:'operation') AS contributions;
SELECT projection.operation_id,projection.ledger_operation_id,projection.amount_kobo,projection.contribution_id,
  contribution.goal_id,contribution.amount*100 AS contribution_kobo,contribution.source_type,contribution.status,
  contribution.idempotency_key,contribution.metadata->>'operation_id' AS metadata_operation,
  contribution.metadata->>'provider_transaction_id' AS metadata_provider_transaction
FROM prefunded_card.projections projection JOIN public.customer_savings_contributions contribution
  ON contribution.id=projection.contribution_id WHERE projection.operation_id=:'operation'::uuid;
SELECT account,amount_kobo FROM piggyvest_savings_ledger.postings WHERE operation_id=:'operation'::uuid ORDER BY account;
SELECT provider_transaction_id,operation_id FROM prefunded_card.provider_aliases
WHERE integration_id=:'integration'::uuid AND operation_id=:'operation'::uuid;
SELECT notification.id,notification.event_key,notification.type,notification.voided_at,
  notification.push_expanded_at,count(delivery.notification_id) AS device_delivery_rows,
  array_agg(DISTINCT delivery.status) FILTER (WHERE delivery.notification_id IS NOT NULL) AS delivery_statuses
FROM savings_notifications.events notification LEFT JOIN savings_notifications.deliveries delivery
  ON delivery.notification_id=notification.id WHERE notification.goal_id=:'goal'::uuid
GROUP BY notification.id ORDER BY notification.event_key;
SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolvaliduntil FROM pg_roles
WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence');
ROLLBACK;
```

Evidence gate: exactly one target event, `verified`, `internal_transfer`,
`wallet-transfer.outflow.success`, canonical category `wallet-transfer`, NGN,
amount 10000, fee 0, unconflicted, every crosswalk flag true and no conflict row.
Business authority is `provider_evidence.business_id`, not a fabricated JSON key.
All other matching observations must be consistent; a deferred observation
does not supply verified money evidence. Parent compares the fingerprint to
the preserved original receipt and its already-verified HMAC/AEAD provenance.
Expected native transaction ID is `PVB01M3YP6SFJQTJQWE83SC5RMX1V`; the event-only
`pvb_reference=PVB01M3YP7BF72MD3PXVY2G8ZXCS0` is different and must not replace it.
Inner third-party/initiator references corroborate the native transaction ID;
inner reference/internal reference corroborate `01M3YP6VMSZX61CMB5V4Z07RAJ`.
The operation transfer reference is `pvbt-ff561046-58e7-428d-9163-f6e60b0dab65`.
Public/FAAS equality comes from authenticated wallet `faas_wallet_identifier`
readbacks; customer UUID, API alias and business customer are distinct namespaces.

For the signature-presence/hash read, use the separate receipt database:
`/usr/bin/docker --host=unix:///var/run/docker.sock exec -i pvb-staging-receipts-db /usr/local/bin/psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres`.
This proves storage linkage, not HMAC/AEAD validity; parent retains the latter proof.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL search_path=pg_catalog;
DO $identity$ BEGIN
  IF current_database()<>'postgres' OR session_user<>'supabase_admin' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7686901100561231906'
  THEN RAISE EXCEPTION 'receipt identity refused'; END IF;
END $identity$;
SELECT receipt.id,receipt.payload_sha256,signature.received_at,
  signature.receipt_id IS NOT NULL AS signature_preserved,
  signature.payload_sha256=receipt.payload_sha256 AS signed_payload_hash_matches
FROM public.piggyvest_staging_receipts receipt LEFT JOIN public.piggyvest_staging_receipt_signatures signature
  ON signature.receipt_id=receipt.id WHERE receipt.id='0f9938ae-8551-4e2e-8816-853e0231b2c3';
ROLLBACK;
```

## Protected rows, not just balances

Before/after completion, compare the parent's retained all-relation row-hash
inventory and permanent metadata baseline from the already-applied claim-boundary
review. Do not rerun its installer. Allow only this operation/queue/intent,
this projection/alias/canonical operation and its postings, this contribution,
new-goal current amount/status/completion/update timestamp, expected notification
event/device rows, and treasury reserved/consumed delta. Independently scoped
snapshot housekeeping is not a license to ignore other treasury changes.
All old-goal history, retired rows/audits, other customers/plans, mappings,
credit routes, treasury identity/replenishments and catalog/function metadata
must retain their prior hashes. Missing full baseline means no all-protected
rows claim. Existing `protected_snapshot.prove_unchanged` compares *everything*,
including the legitimate target changes; do not treat its expected difference
as a bypass. This bounded digest gives an additional old/retired witness:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL search_path=pg_catalog;
DO $identity$ BEGIN
  IF current_database()<>'postgres' OR session_user<>'postgres' OR inet_client_addr() IS NOT NULL
    OR (SELECT system_identifier::text FROM pg_control_system())<>'7685292944002592802'
  THEN RAISE EXCEPTION 'application identity refused'; END IF;
END $identity$;
WITH protected(kind,payload) AS (
  SELECT 'old_goal',to_jsonb(goal) FROM public.customer_savings_goals goal
    WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'
  UNION ALL SELECT 'old_contribution',to_jsonb(contribution) FROM public.customer_savings_contributions contribution
    WHERE goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
  UNION ALL SELECT 'old_ledger_operation',to_jsonb(operation) FROM piggyvest_savings_ledger.operations operation
    WHERE goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
  UNION ALL SELECT 'old_posting',to_jsonb(posting) FROM piggyvest_savings_ledger.postings posting
    JOIN piggyvest_savings_ledger.operations operation ON operation.id=posting.operation_id
    WHERE operation.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
  UNION ALL SELECT 'retired_operation',to_jsonb(operation) FROM prefunded_card.operations operation WHERE checkout_retired
  UNION ALL SELECT 'retired_intent',to_jsonb(intent) FROM prefunded_card.checkout_intents intent
    JOIN prefunded_card.operations operation ON operation.id=intent.operation_id WHERE operation.checkout_retired
  UNION ALL SELECT 'retirement',to_jsonb(retirement) FROM prefunded_card.checkout_retirements retirement
  UNION ALL SELECT 'treasury_identity',to_jsonb(identity) FROM prefunded_card.treasury_identities identity
  UNION ALL SELECT 'replenishment',to_jsonb(replenishment) FROM prefunded_card.treasury_replenishments replenishment
)
SELECT kind,count(*),encode(sha256(convert_to(jsonb_agg(payload ORDER BY payload::text COLLATE "C")::text,'UTF8')),'hex') AS sha256
FROM protected GROUP BY kind ORDER BY kind;
ROLLBACK;
```

## Existing services: inspect, do not blindly activate

```sh
/usr/bin/systemctl show baci-prefunded-background.service baci-prefunded-snapshot.service \
  baci-savings-notifications.service baci-savings-notifications-check.service \
  -p ActiveState -p Result -p ExecMainStatus -p InvocationID -p ExecStart -p ExecStopPost \
  -p FragmentPath -p DropInPaths -p NeedDaemonReload
/usr/bin/systemctl show baci-prefunded-background.timer baci-prefunded-snapshot.timer \
  baci-prefunded-deadline.timer baci-prefunded-replay-deadline.timer \
  baci-prefunded-public-deadline.timer baci-savings-notifications-deadline.timer \
  -p ActiveState -p TimersCalendar -p NextElapseUSecRealtime -p FragmentPath -p DropInPaths -p NeedDaemonReload
/usr/bin/systemctl show baci-prefunded-deadline.service baci-prefunded-replay-deadline.service \
  baci-prefunded-public-deadline.service -p ExecStart -p FragmentPath -p DropInPaths -p NeedDaemonReload
/usr/bin/docker --host=unix:///var/run/docker.sock inspect baci-prefunded-background \
  pvb-staging-replay-prefunded --format '{{.Id}} {{.Name}} running={{.State.Running}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
```

1. Parent revalidates reviewed generation/seal/isolation/current ABI, fresh
   independent treasury snapshot, current claims source, six-role/JWT scope and
   effective Oct 6 stoppers. No drop-ins/reload drift. Older September defaults
   in installers/docs are not authority to reinstall or extend anything.
2. The existing completion entry is `baci-prefunded-background.service`, whose
   ExecStart attaches `baci-prefunded-background`. It runs recovery **then a
   dispatcher**, not a completion-only mode. Therefore this document deliberately
   supplies no start command. Before authorizing one existing scoped pass, parent
   must hold new checkout admission closed, prove no other admissible work,
   collection `verified_success`, verified collection proof/funding_pending,
   target transfer already attempted and `dispatching|pending|unknown`, no active
   lease and queue normally due. Stop on any `not_started` dispatchable leg.
3. Installed stored-first verification must return the genuine evidence. The
   worker itself claims a fresh reconciliation token/fence and completes within
   its lease; never supply, fabricate or reset either. No direct money RPC.
4. One unresolved-transfer runtime invocation completes the transfer, but does
   **not** project in that same call. `finish_dispatch` normally defers 30 seconds.
   A later normally eligible pass projects an already-verified operation. This
   is exactly-once credit, not a promise that one service invocation does all
   stages. Never fast-forward availability/backoff or force a duplicate pass.
5. Require fresh service invocation/result plus SQL outcomes, not `{status:
   completed}` alone. Treasury becomes reserved/consumed 0/10000 exactly once;
   operation transfer `verified_success`, projection `applied`, cleared leases,
   queue finished. Checkout phase alone is not proof; it may still funding_pending.
6. Require one projection, one canonical operation, one completed NGN100
   `paystack_authorization` contribution with `pvb-card:<operation>` identity,
   principal posting +10000 and internal_clearing -10000 (two postings, net zero),
   alias bound to the genuine transaction, new principal +10000, old principal
   unchanged and unchanged protected hashes. No bank-inflow substitute credit.
7. Notifications are keyed by merchant/customer/goal/event_key, not provider
   event ID. For the first contribution the trigger emits the highest crossed
   milestone (100 means goal_completed), otherwise `first-contribution`; require
   exactly one expected key, no duplicate financial event. Delivery rows are per
   device, so zero/multiple rows can be correct. Quiet hours/preferences can defer
   push; accepted tickets are not confirmed receipts. Do not start the notification
   sender or mutate preferences to force delivery. Financial credit and push
   delivery are separate proofs; preserve their exact observed status.

## Source anchors reviewed

- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/evidence-record.sql`: exact observation keys and verified native semantic boundary.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/evidence-transfer.sql`: scoped stored evidence read and crosswalk refusal.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/storage-functions.sql`: lease/token/fence completion and treasury consumption.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/projection-functions.sql`: exactly-once ledger, contribution and goal projection.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql`: existing additive admission gate, not a blanket dispatcher disable.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/apps/web/src/lib/piggyvest/prefunded-card-runtime.ts`: fenced completion and later projection, not same-call completion.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/runtime_scheduler.py`: existing combined service command; older deadline is not current authority.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/checkout-claim-boundary/snapshot.sql`: full relation/catalog baseline protection.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/supabase/migrations/20260912120500_piggyvest_savings_ledger_numeric_reference_casts.sql`: balanced two-posting principal credit.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/supabase/migrations/20260925130100_customer_savings_engagement_events.sql`: unique trigger keys and milestone/first-contribution branching.
- `/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/receipt_provenance_contract.py`: exact preserved signature table columns.
