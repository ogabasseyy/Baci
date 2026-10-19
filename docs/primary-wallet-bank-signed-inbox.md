# Primary bank signed receipt replay

Local source, mocked transport and isolated PostgreSQL evidence only. No remote
configuration, credentials, provider call, deployment or live financial write.
Parent owns the shared webhook and migration registry. Its connected webhook
calls the intake below before synchronous primary credit or legacy processing.

## Stable parent intake contract

`apps/web/src/lib/piggyvest/primary-wallet-bank-inbox-intake.ts` exports
`dispatchPrimaryWalletBankInboxIntake({ rawBody: Uint8Array, signature: string | null, env?: NodeJS.ProcessEnv })`.

Call only for a globally signature-verified `bank-transfer.inflow.success`, using
untouched bounded raw bytes. Intake independently verifies the configured HMAC,
prepares the existing provider receipt contract and commits raw bytes/signature
under the intake-only login. No provider lookup, monetary action, synthetic goal,
phone/email matching, hyphen normalization or bank-to-card reference guessing.

Result is `{ outcome, response }`:

| Outcome | Response | Durable meaning |
| --- | --- | --- |
| accepted / duplicate | 200 `bankQueued: true` | Signed receipt retained; **not wallet credit**. |
| conflict | 200 `quarantined: true` | Exact original/alternate signed bytes retained, blocked for review. |
| unavailable | 503 | Configuration/signature/storage failure; do not acknowledge success or fall through. |
| not_handled | null | Active database lookup positively found no matching primary wallet/customer claim; continue legacy. |
| disabled | null | Feature absent or explicitly false; old deployment needs no new secret and retains existing behavior. |

Explicit true with malformed/incomplete settings fails closed. Unknown flag
values are errors, not disabled. Activation must enable the inbox before relying
on the new prerequisite result: older synchronous executor outcome allowlists do
not consume it. Default/disabled compatibility alone does **not** close the old
bank-before-custody gap. No successful queued acknowledgement constructs the
legacy client or invokes synchronous credit in the parent route.

## Frozen appended SQL

Registered `20261007200600` bytes are unchanged. The append replacement retains
the ledger's financial identity checks and changes only its owned-card pending
dependency from `conflict` to `prerequisite`, plus constrained worker authority.
Different known financial identities remain conflicts. Intake records accepted
or verified exact owned mappings; replay requires a verified intent and matching
customer/merchant/user relationship. Missing verification stays prerequisite.

The inbox keeps original raw bytes/signatures/digests immutable, stores alternate
same-event bytes separately, denies generic RLS/table access, and uses dedicated
intake/worker function-only capabilities. Leases are 60 seconds, token fenced and
reclaimable; delays grow to 900 seconds. Fifty failed attempts retain a blocked
receipt for operator review—never deletion or a processed acknowledgement.

The worker rechecks SHA-256, configured current/retained HMAC keys, exact event
identity and the existing bank event schema before submitting a receipt.
Processing compares all financial receipt fields to immutable signed bytes.
UTC millisecond timestamp normalization matches `Date.toISOString`; raw timestamps
and wire bytes are unchanged. Lease validation, original ledger application and
processed/deferred/blocked inbox transition commit atomically in one SQL call.

While custody proof is pending, bank receipts defer without money movement.
After approved custody aliases arrive, card-related receipts replay as duplicate;
an unrelated genuine bank deposit credits exactly once. Missing keys persist
`io_retry` and raise a redacted operational error. Storage, scope, stale lease or
retry-persistence errors fail the worker; none report financial completion.

Readiness checks exact integration/environment/merchant/business/deadline,
restricted finite login expiry, verified TLS/CA, safe login/group flags, direct
membership, capability ancestors, required exact RPCs and unexpected **effective**
RPC/table/sequence grants including PUBLIC. It rejects SET ROLE identity changes.
Inventory all nonsystem effective ACLs in the real target before approval. The
fixture's blanket PUBLIC-function revokes are test baseline isolation, **not** a
production installer or instruction to revoke live grants wholesale.

## Stable SHA-256 values

```text
20261007230000_primary_bank_signed_inbox.sql
d5fafe3c4442b8acca9941023cc2733444ada4a60f9592f1c907a2d4a51dc240
20261007230100_primary_bank_custody_prerequisite.sql
bf67419b6357ec7a9b4a065cc4fd5350bae806aa2c0912d893a53d7afcc4d723
20261007230200_primary_bank_inbox_worker.sql
0857e105395279aafc467e9c5abe14bbc5221dfaeea1b5a175aa2ed64cc5f39e
```

## Runnable restricted retry

`tools/staging/primary-wallet-bank-inbox/primary-wallet-bank-inbox-entry.ts`
invokes the existing restricted store/worker, not a new financial framework.
Its `--readiness` validates capability without a claim; `--once` claims at most
one receipt and logs only numeric counters. Failure exits nonzero with a generic
message; SIGINT/SIGTERM stop further processing and leave leases recoverable.
See the colocated README for commands and the existing oneshot/timer pattern.
The entry loads with borrowed dependencies; its invalid-argument smoke exits 1
without a database/provider operation. CLI behavior tests are mocked, not remote
readiness or successful deployment evidence.

## Local validation and remaining gates

Six bank/schema suites pass 27 tests including real isolated PostgreSQL; the
cluster is stopped. SQL proves bank-before-proof deferral, completed-card alias
deduplication, a genuine independent bank deposit, financial conflict retention,
unchanged earnings, exact signed economics, lease fencing/reclaim, retained retry
exhaustion and capability ancestor/table/RPC/missing-RPC rejection. Test-only
fixture data grants live in the session's temporary schema, not financial tables.
Two CLI suites pass four tests. Final scoped Biome covers source/tests/entry.

Parent still must register/apply frozen SQL, approve effective ACL inventory,
provision only the two restricted logins and owner-disabled authority/config,
activate intake before immediate primary dispatch, then install/monitor a reviewed
worker timer. Credentials and raw evidence retention/encryption/key rotation are
operator-owned. No scheduler or remote role was installed here. Provider-approved
custody aliases, card transfer/settlement evidence and deployed savings transfer
remain prerequisites for the actual bank → wallet → savings path. Queue acceptance
or local proof does not establish that customer-facing path in production.
