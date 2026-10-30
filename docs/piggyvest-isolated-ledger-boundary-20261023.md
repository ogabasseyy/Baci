# Isolated PiggyVest ledger boundary and reliable handoff

Status: design proposal, not implemented or approved for production. Live payments remain disabled. No database, role, service, key, provider setting or existing account is changed by this document.

## Decision and scope

Use a separately controlled PostgreSQL **cluster** for the complete PiggyVest financial aggregate. Keep hosted Supabase for application Auth, merchant/customer profiles, catalog and customer-scoped read models. Preserve the current financial transaction boundary rather than moving only webhook storage. Do not introduce two authoritative balances or a distributed transaction.

This is the selected design direction for review, not a claim that isolated infrastructure has been deployed. Another database in the existing managed cluster does not alone isolate shared roles. Creating another ordinary Supabase project would not establish control over the same managed PUBLIC grants.

First implementation slice: newly enrolled, explicitly routed PiggyVest accounts, bank funding, wallet-to-savings contributions, verified paid interest/reversals and their customer display. No automatic migration or replay of existing provider wallets, recording accounts, funds or legacy plans.

Utilities, checkout, refunds, withdrawals and card-funded flows must not consume an isolated balance until their financial writes are inside the same authority contract. Existing legacy balances remain separate; never copy isolated balances into a legacy spendable customer_wallets row. Combining numbers for display must not make their sum spendable. Every server write path must enforce the persisted rail/enrollment binding, not a UI flag.

## Authority ownership

| State | Authoritative owner | Other side |
| --- | --- | --- |
| User session, merchant membership, catalog, profile | Supabase application | Minimal verified identity/catalog facts admitted into ledger |
| Enrollment: integration/business/environment, customer/user IDs, rail and epoch | Server-issued application enrollment plus ledger acknowledgement | Both retain the immutable matching binding; no automatic reassignment |
| Provider customer/wallet crosswalks and reconciliation evidence | Isolated ledger | Masked customer-facing account details only |
| Spendable/held funds, principal, paid interest, reversals | Isolated ledger | Read-only projections; never spending authority |
| Goal financial terms, status, contribution operations and provider references | Isolated ledger | Goal metadata/read model in application |
| Durable signed webhook intake, conflicts, dispatch/recovery leases | Isolated ledger | Transport acknowledgement/operation ID only |
| Financial notification intent, dedupe key and void/reversal state | Isolated ledger | Delivery receipts and app display, not financial effects |

The isolated database must contain the minimal customer/goal/wallet structures referenced by existing SQL contracts. Inside that database, existing public.customer_wallets, customer_savings_goals, customer_wallet_transactions and customer_savings_contributions become **isolated canonical financial tables**, not remote Supabase tables. They are not synchronized bidirectionally. Profile fact changes arrive through a typed authenticated command; client-selected ownership is never trusted.

## Reuse audit

| Existing implementation | Reuse | Necessary adaptation |
| --- | --- | --- |
| primary-wallet-bank-inbox-store.ts and bank inbox intake/worker | Durable bytes, conflict/dedupe, leases, exact session/TLS checks | Bind isolated cluster; retain RPC-only guard and no broad memberships |
| live-webhook-relay.ts and schemas/piggyvest-live-relay.ts | Bounded raw-byte forwarding and digest-bound acknowledgement | Wire only after receiver durability and separate activation approval |
| primary-wallet-savings-store.ts | Reserve, pending recovery, status and dispatch/cancel lifecycle | Place HTTP/auth boundary in front; keep SQL state machine |
| primary-wallet-savings-reconciliation-store.ts and proof verifiers | Provider attribution, settle/release and detached-row handling | Run against isolated authoritative tables; no projected status as evidence |
| 20261007150000_piggyvest_primary_savings_settlement.sql and follow-ups | Atomic goal/transaction/contribution settlement | Install reviewed dependency chain; append outbox emission in same transaction |
| piggyvest_savings_ledger.apply and 20261003160000 deferred checker migration | Balanced, immutable postings and pinned checker authority | Reuse reviewed migration history, not fixture superuser shortcuts |
| primary-wallet-paid-interest-inbox-store.ts and paid-interest workers | Signed receipt retention, mapping, paid-only credit and reversal rules | Retain provider/customer crosswalk and independent policy gates |
| savings_notifications events/receipts and interest notification triggers | Financial event keys, completion dedupe and reversal voiding | One notification dispatcher owner; app must not regenerate intents from projections |
| primary-wallet-savings-recovery-runtime.ts and primary-wallet-paid-interest-runtime.ts | Disabled-new-work versus receipt-drain separation | Preserve credentials/scope checks during drain and shutdown |
| transfer-outbox.ts | Attribution/idempotency examples only | NOT the read-model delivery outbox; it tracks provider transfer submissions |
| Wallet API wallet-data.ts and mobile wallet consumers | Response presentation and UI | Add rail-aware read adapter; never sum mirrored financial rows twice |

These are reuse candidates established by source inspection, not assertions that changing a connection string makes them production-ready. All routes/writers for the first slice require a completed inventory before enrollment can be enabled.

## 1. Application-to-ledger command admission

1. Existing protected application routes first call auth.getUser(), enforce CSRF where applicable, validate input with Zod, and resolve merchant/customer ownership through the authenticated RLS client. Resolve trusted host/merchant context; a request body cannot select another tenant, provider wallet or enrollment.
2. The application issues a narrowly scoped signed command over verified TLS to a private ledger gateway. Use a dedicated direction-specific signing key, separate from provider, relay and projection keys. Neither clients nor Vercel need provider keys or ledger administrator credentials.
3. Envelope fields: schemaVersion, commandId, operationId, integrationId, businessId, environment, merchantId, customerId, userId, enrollmentEpoch, expectedLifecycleVersion, audience, issuedAt, expiresAt, keyId, command kind and normalized payload hash. Hash all semantic identity/scope/terms/amount fields, excluding only renewable transport timestamps/signature/key selection. A refreshed envelope retains both commandId and operationId. Money is integer kobo, never floating-point naira. Supported kinds are explicit, not arbitrary SQL/RPC names.
4. Proposed initial new-command lifetime: at most 60 seconds, with at most five seconds clock skew. These are design limits to validate in tests, not installed settings. Ledger validates signature, audience, lifetime and its persisted enrollment binding independently. Refreshing an expired envelope must retain the same operationId and payload hash.
5. In one local ledger transaction, insert the command receipt under a unique enrollment-scoped command/operation key and apply its existing reserve/provisioning transition. Same identity plus same hash returns the previous result; same identity with different hash is a conflict. A retry cannot create a new hold or provider transfer.
6. Return accepted/pending only after commit. Lost acknowledgement means query/retry the same identity; never allocate a replacement operationId because the response timed out. The gateway exposes an authenticated operation-status/recovery endpoint using existing stores.

A durable accepted command is the authorization boundary: later browser logout is not proof that an already dispatched provider transfer vanished. Before acceptance, fail closed on stale/revoked enrollment. Admission, activation and closure lock the **same ledger enrollment row** and compare the expected lifecycle version. The lock order is enrollment, customer wallet, goal, operation; any multi-goal locks are taken in stable ID order. A closure commit moves active -> closing, increments lifecycleVersion and blocks subsequent new admission, including still-valid signed commands. Already accepted operations retain exact-identity status/recovery and verified receipt drain; they cannot be changed into fresh operations.

App-side closure first commits revocation_pending and stops issuing commands, then retries the same signed lifecycle control request until ledger acknowledgement. Do not claim revocation is globally effective before that acknowledgement: a previously issued command can win admission before the ledger closing transaction. Display pending closure during outages. Move closing -> closed only after accepted work is terminal/reconciled under the reviewed closure policy. Never delete identity/crosswalk evidence to simulate closure; concurrent ownership changes require explicit close/rebind, not a profile upsert.

Enrollment handshake is explicit: (a) application durably records prepared enrollment ID/epoch, immutable identity and stream genesis; (b) ledger durably creates a bound_inactive enrollment and returns that same binding; (c) application commits activation_pending plus the acknowledged genesis; (d) signed activation request compares bound_inactive and expected lifecycleVersion under the ledger enrollment lock, commits active and increments its version; (e) application exposes active only after recording the matching ledger acknowledgement. The issuer checks this application-active receipt before sending financial commands; ledger admission independently requires its own active binding/version. Recover uncertain steps by status lookup and the same enrollment/epoch, never replacement creation. Closing/closed are irreversible for that epoch and reject delayed activation messages; a higher lifecycle version cannot be overwritten by an old acknowledgement. A new enrollment epoch requires explicit authorization. Provider account creation/exposure must be gated by this lifecycle, not by an intermediate app screen.

Application acknowledgement updates are compare-and-set, not profile upserts: binding ACK requires the original prepared state; activation ACK requires the original activation_pending state, activationRequestId and unchanged applicationControlVersion. Every cancellation/revocation increments that local control version and persists its outgoing closure request atomically. A delayed activation ACK cannot change revocation_pending/cancelled back to active even when it carries the latest known ledger version; retain it only as evidence and continue closure. The ledger echoes the request/control identity in its durable activation receipt.

Cancellation is valid from prepared, bound_inactive, activation_pending or active. If cancellation reaches the ledger before binding, persist an authenticated identity/epoch tombstone so delayed bind/activate requests cannot recreate the enrollment. Otherwise serialize cancellation on the same enrollment row and move to closing; close immediately only when there is no accepted/provisioning work to drain. If ledger activation won but its ACK has not reached the app, the app stays revocation_pending and keeps retrying closure rather than issuing financial commands. Reconcile uncertain provider provisioning before declaring closed.

Catalog edits do not change an existing financial target implicitly. A device/terms change is a versioned command using the existing capacity checks; the ledger holds the accepted target/version used for settlement.

## 2. Financial settlement and outbound delivery

The ledger is the sole writer. Reuse signed provider evidence, inflow attribution, reservations/holds, dispatched operation identity, paid-interest receipts and existing reversal logic. Provider acceptance, an HTTP 200, a client “I've funded” tap or a projection are not settlement proof. Unknown provider outcome remains pending/reconciliation-required; do not retry a transfer with a new reference after a 404 or timeout.

One ledger transaction commits financial postings/holds, wallet balance, goal state, contribution/transaction rows, notification intent where applicable, and a new immutable application-delivery outbox event. An outbox insertion failure must roll back the financial mutation. Do not create this event later in an HTTP handler.

Choose one ordered stream per (environment, integrationId, customerId, enrollmentEpoch). Lock that customer's aggregate, increment its version, and insert one unique (stream, sequence) event in the financial transaction. Every stream mutation must pass this path; no writer may bypass version/outbox generation. If an operation touches multiple customer aggregates, it is outside the first slice until its locking/version contract is specified.

Event fields: schemaVersion, eventId, stream scope, sequence, previousSequence, ledger operation/reference identity, event kind, committedAt, keyId and body digest. Body contains **absolute values for the affected wallet/goal/transaction projections**, not instructions to credit money. Include accepted goal terms/version and financial notification IDs/void state when relevant. Do not export BVN, provider secrets, unmasked evidence payloads or unnecessary profile details. Enforce an explicit bounded payload; large transaction history is paginated, not embedded wholesale.

Dedicated delivery worker claims expiring leases and posts exact event bytes, authenticated with its limited machine identity and a direction-specific HMAC-SHA256 over a versioned domain prefix plus those bytes. Keep the original event ID, sequence, digest and body across retries. Keys rotate with keyId and a bounded overlap/drain policy; old accepted receipts cannot become undeliverable merely because intake was switched off.

## 3. Supabase projection receiver without a direct DB login

Use a dedicated **ordinary Auth machine principal** through the Data API, not postgres, service_role, a managed-role membership or a new direct database LOGIN. Provisioning this principal and its server-owned authority mapping is a separate deployment step. Do not put an unrestricted JWT-signing secret in the delivery worker.

The receiver validates its authenticated machine identity plus event signature/scope. A narrowly scoped projection-apply RPC repeats the authority, digest and envelope checks before writing. Use a private authority mapping keyed by Auth UID, integration, enrollment and allowed signing key; never trust editable user_metadata or a body-selected tenant. Its only effects are receipt/read-model writes. Any SECURITY DEFINER helper must have a restricted owner, pinned search_path, explicit caller checks and revoked ambient execution; a public invoker wrapper is not an authorization bypass. This new RPC boundary requires independent security review.

New projection/inbox tables have RLS enabled, customer-scoped SELECT through trusted customer/user membership, and no user INSERT/UPDATE/DELETE. Projector cannot mutate canonical financial tables, legacy wallet balances, Auth or provider mappings. The UI continues using its authenticated RLS client. No generic privileged Supabase client is introduced into user-facing routes.

In one managed-database transaction:

- Verify the exact stream binding and permitted producer; reject wrong environment/business/customer/epoch.
- Insert an immutable receiver inbox identity and digest. Equal duplicate returns its durable status; a changed digest or reused sequence with another event is quarantined and alerts, never silently accepted as the original.
- Require sequence = appliedSequence + 1 before applying affected projection rows and advancing the checkpoint. First event requires a pre-established enrollment genesis/checkpoint, not an arbitrary version supplied by the caller.
- Older equal receipts are duplicates. Future events are stored durably as waiting-for-gap and do not update balances. Missing predecessors are replayed from the sender's retained outbox. Do not skip a gap simply because a newer wallet snapshot exists: it might omit a goal changed by the missing event.
- Acknowledge only after commit. A stored waiting event can be acknowledged as durably retained with an explicit waiting status; the sender tracks durable receipt separately from applied checkpoint. Conflicts need operator reconciliation, not automatic acknowledgement as successfully applied.

Every receiver transaction serializes on the stream checkpoint. After applying a predecessor, it drains the next contiguous stored events in that same transaction, up to a tested batch/time bound (initial proposal: 64 events or two seconds). If work remains, commit a durable drain_pending marker. A scheduled receiver drain worker, using the same limited Auth principal/RPC boundary, resumes these markers after crashes and continues without requiring another delivery of an already acknowledged event. It revalidates stored immutable event digests/authority and stops on a missing sequence or conflict. A duplicate waiting receipt must never clear the marker. Receiver acknowledgements and periodic status responses carry both durable-received identity and applied checkpoint; source monitoring alerts if receipt advances while application remains stalled.

Do not delete or compact source events in the initial implementation. Rebuild an empty read model by bounded ordered replay from the recorded enrollment genesis. Signed multi-page checkpoint snapshots/retention compaction require a later design and tests; until then, a missing retained event is an incident, not permission to fast-forward.

## 4. Customer behavior and notification ownership

Read model responses expose source rail, enrollment, applied sequence and ledger committedAt. An old committedAt alone cannot distinguish an idle wallet from missed delivery. Add a bounded, authenticated ledger-watermark read returning current stream sequence and observedAt for the exact enrollment; no signing-key/provider details are returned. Only a successful recent watermark comparison may label the projection current. A mismatch shows Updating; an unavailable/expired freshness check shows freshness unknown, not an invented zero. Proposed watermark cache lifetime is at most 30 seconds and must be tested, not treated as spending authority. A displayed/projected balance is never used to authorize spending; new contributions always read/reserve against the ledger.

After command acceptance, retain its pending operation until an authoritative ledger terminal result and the associated projection sequence are reconciled. Operation-status reads may return a newer ledger result while app projections catch up; show confirmed-but-updating rather than reporting failure or releasing funds because the projection is delayed.

Use existing financial notification event keys and delivery receipts. Select one dispatcher for isolated enrollments: initially the isolated-side worker is the sole financial notification owner, with separately scoped delivery capability and existing key dedupe. Projection updates do not emit a second interest/contribution notification. Reversal/void commands fence pending delivery. An already delivered OS push cannot be recalled reliably; customer details must resolve current operation state. Device push-token registration/delivery access needs a separate least-privilege design before enabling notifications.

Legacy routes continue unchanged for legacy enrollments. For isolated enrollments, persist the binding first and gate old mutation/replay paths server-side. No fallback may write a legacy balance because the isolated service is unavailable. Existing wallet/goal IDs cannot be silently rebound. Existing-record migration requires an explicit freeze, provider/ledger reconciliation, verified opening checkpoint and separate owner approval.

## Failure and recovery contract

| Failure | Required behavior |
| --- | --- |
| Command accepted, reply lost | Same operation identity/status recovery; one reserve/dispatch |
| Provider request timeout/uncertain 404 | Retain reference/hold, reconcile evidence; no blind transfer replay |
| Provider receipt duplicate/conflicting alias | Existing attribution/dedupe/conflict rules; no extra credit |
| Financial transaction/outbox insert abort | Neither financial effect nor event commits |
| Sender crash after receiver commit | Retry identical event; receiver duplicate, one projection effect |
| Receiver transaction abort | No checkpoint/projection advance; sender retries |
| Event N+1 arrives before N | Retain waiting event; replay N, drain stored successors, persist/resume bounded drain work |
| Forged identity/epoch, digest mismatch or version collision | Reject/quarantine and alert; no projection/financial write |
| App database or delivery worker unavailable | Ledger receipts persist; backlog grows; UI reports lag/freshness unknown using authenticated watermark |
| Isolated ledger unavailable | New financial writes fail closed; no hosted-ledger fallback |
| Intake paused/rollback | Stop new enrollment/reservation/dispatch; keep verified receipt drain, recovery and delivery enabled |
| Restore from backup | Retain scope/epochs and references; replay/reconcile checkpoints before enabling new work |

At-least-once delivery plus durable dedupe gives one committed application effect per identity, not exactly-once network delivery. Never mark an outbox event financially “settled” based on projection acknowledgement.

## Implementation slices and acceptance gates

1. Inventory and freeze the dependency/writer matrix for the first slice, including onboarding, device changes, deletions, checkout/utility exclusions and existing rail routing. Review this ownership design before implementation.
2. Reuse the local separate-cluster harness and reviewed ledger migration dependency chain. Add no-live synthetic enrollment and command acceptance/recovery tests. Assert exact session/TLS boundaries and denial of excess privileges.
3. Append command receipt, version/outbox and enrollment lifecycle migrations; keep all financial updates and outbox emission atomic. Add duplicate/different-hash, concurrent reserve, abort/outbox failure and provider uncertainty regressions; race activation/admission against closure and prove stale lifecycle messages cannot reopen an epoch. Specifically test cancel-before-bind/activation and revocation after ledger activation but before app ACK: stale ACKs must not restore issuance, and closure remains queued durably.
4. Build the scoped Data API machine-principal receiver and RLS read models, with colocated schemas/tests. Prove that ordinary customers, another projector, wrong scopes/epochs and direct table writes cannot update them. Test token refresh/rotation without a service-role fallback.
5. Implement lease/retry/gap replay, bounded durable drain and rail-aware read adapters. Test lost ACK, crash after commit, duplicate waiting events, out-of-order receipt, poisoned stream, drain restart, full replay and reversal/notification races. Test idle versus delayed watermark/freshness states and pending-operation/projection convergence. Prove existing legacy spend paths cannot consume isolated balances.
6. Rehearse end-to-end with synthetic provider fixtures, verified TLS and restart/backup recovery. Compare canonical ledger balances and app checkpoints; do not claim local SQL tests alone prove deployment/provider delivery.
7. Separate activation review: capacity, monitoring/alerts, retention, secrets, restricted logins, backups, schedules, scopes and business binding. Initially all production flags/authorities remain absent/disabled. No implementation slice itself authorizes live activation.

This document defines contracts and test requirements only. No handoff schema, receiver, projector, command gateway or production migration described as new above has been implemented in this step.
