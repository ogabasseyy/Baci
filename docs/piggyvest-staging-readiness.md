# PiggyVest Business Wallets staging preparation

Evidence checked: 11 September 2026. Local base: `d0d1cbd2fd`.

**Later update:** The owner requested implementation after the initial preparation and explicitly approved staging DNS changes. A separate registration-only service is now deployed and publicly verified over HTTPS at `https://staging.ogabassey.com/api/webhooks/piggyvest`. See [current deployment handoff](./piggyvest-staging-deployment.md), including the local DNS-cache caveat. The sections below retain the initial investigation and requirements; their undeployed/unapproved status describes that earlier snapshot. Financial webhook processing remains disabled.

## Scope and current state

The owner reports that Anjola approved the wallet-interest use case on 9 September. This approval is accepted. Interest eligibility, exact commercial terms and production certification still require their own technical/operational evidence. Ogabassey retains catalogue, savings UX and fulfilment. GetIT and cross-app goal synchronization are outside this task.

| Area | Evidence / readiness |
| --- | --- |
| Existing savings | Customer savings routes, contribution accounting, Paystack webhook and scheduled auto-debit already exist. Preserve these flows; do not add PiggyVest events to Paystack handlers. |
| Duplicate work | No PiggyVest/Piggytech matches in this checkout; no matching local branch or open GitHub PR found. This does not prove absence of unpublished work elsewhere. |
| Proposed staging URL | `https://staging.ogabassey.com/api/webhooks/piggyvest`: DNS lookups returned NOERROR with zero A, AAAA or CNAME answers; HTTPS HEAD failed with curl error 6 (host unresolved). No HTTP response, TLS validation or reachability established. |
| Staging infrastructure | No staging.ogabassey.com configuration found in checked repo workflows/docs. Read-only Vercel project listing/inspection confirms main project `baci` in `basseys-projects-d7395611`; no dedicated staging project was identified. Domain inspection reports no access to staging.ogabassey.com under that team (not proof that no configuration exists elsewhere). Staging target, isolated database and domain configuration remain unverified. |
| Provider profiling | Requested by Anjola according to owner-supplied conversation; completion unverified. |
| Credentials | No staging credentials verified or used. Limited mailbox results included invitations and partnership correspondence; no credential delivery was established. Search returned a broad result set, so sender/subject filtering was applied; this is not an exhaustive mailbox audit. No transaction message bodies were inspected. |
| Local implementation | Disabled GET/POST route and server-only signature primitive with synthetic tests. No provider requests, database writes, ledger integration or activation switch. |
| Deployment / sandbox testing | Neither performed. No external changes or messages authorized by this preparation. |

## Plan and implemented boundary

1. Inspect existing savings and deployment code, check the proposed hostname, locate public provider contracts.
2. Implement only the documented cryptographic primitive and an unavailable route; test missing configuration and tampering.
3. Resolve the contract gaps below, then implement and test durable intake and reconciliation against an isolated local database.
4. Present a concrete staging deployment/configuration change for owner approval, then verify the deployed path and provider registration separately.

Files:

- `apps/web/src/app/api/webhooks/piggyvest/route.ts`: GET and POST always return local `503 PIGGYVEST_NOT_READY`, with no-store caching. They do not read bodies, credentials or databases, and cannot be enabled through an environment variable. This deliberately prevents the provider's GET registration check from succeeding before the receiver is ready. The 503 is our unavailable response, not a claim about provider retry behavior.
- `apps/web/src/lib/piggyvest/verify-piggyvest-payload-signature.ts`: SHA512 HMAC over explicitly supplied bytes, strict lowercase hex validation, constant-time comparison, missing/blank-secret rejection. The route does not call this primitive yet. The synthetic fixture is a cryptographic test input, not a claimed complete provider event.
- Colocated tests cover the valid synthetic vector, missing secrets, malformed/combined headers, incorrect keys, changed bytes and disabled routes across Vercel environments.

No environment files, proxy, migrations, savings balances or existing payment handlers changed. Existing proxy CSRF handling exempts `/api/webhooks/`; this is not evidence that domain routing, rate limits or deployment protection allow provider delivery. Verify those after deployment approval without casually widening exemptions.

## Official contracts found

- [Signature validation](https://www.piggyvestbusiness.com/docs/webhooks/signature): `x-pvb-signature`, SHA512 HMAC, hex encoding and API secret. The sample signs `JSON.stringify(req.body)` and acknowledges with 200, even on invalid signatures. It does not settle exact raw-byte serialization or failed-persistence retry semantics. The standalone primitive implements the algorithm only; it does not establish production-compatible request authentication. Do not try both raw and reserialized signatures as a permissive fallback.
- [Payload structure](https://www.piggyvestbusiness.com/docs/webhooks/payload): GET 200 is required before registration; POST delivers an envelope containing eventId, customer_id, eventType, eventCategory and eventData, plus applicable wallet/reference fields. Event-specific financial schemas are missing from that page.
- [Events](https://www.piggyvestbusiness.com/docs/webhooks/events): creation, transfer, interest, virtual-account and restriction notifications are listed. Do not infer complete payload schemas from event names.
- [Authentication](https://www.piggyvestbusiness.com/docs/authentication): bearer secret, configurable API base. The published base is not proof of Ogabassey's assigned staging endpoint. Its rate-limit text explicitly asks for support confirmation.
- [Wallet transfers](https://www.piggyvestbusiness.com/docs/api/transfers/wallet): amount is in kobo; 202 indicates queued processing. Confirm completion through webhook or status query. Its terminal wording differs from the [TSQ example](https://www.piggyvestbusiness.com/docs/api/transfers/status), which uses `success`, `pending`, `failed`; resolve exact enums before a state machine is implemented.

## Required from Anjola / API engineering

1. Confirm staging profiling completion, business/account identifiers, assigned API base URL and secure delivery of staging-only credentials to `j.bassey@ogabassey.com`. Confirm whether the webhook key is the API secret, rotation overlap and available least-privilege scopes.
2. Supply current versioned event schemas and synthetic signed raw HTTP samples for wallet creation, inflow, outflow success/failure, wallet transfers and interest payouts. Include header values, encoding, amount units, currency, timestamps, business/customer/wallet IDs and transaction references. Confirm raw bytes versus JSON serialization, including whitespace, key order, Unicode and number representation.
3. Confirm eventId uniqueness scope and stability across delivery retries, timestamps/replay protections, ordering, duplicate behavior and maximum event size.
4. Specify delivery timeouts, retries/backoff, retention, redelivery tooling and behavior when our database is unavailable. Reconcile the documented always-200 guidance with durable acceptance: we must not acknowledge a valid event before durable storage unless another provider-approved recovery mechanism prevents loss.
5. Supply authoritative wallet/transaction reconciliation contracts, pagination/cursors, terminal status enums, reversals/corrections and rate limits. Confirm interest eligibility, accrual versus paid amounts, payout units/timing, fees and restrictions for the approved use case; no rate is assumed.
6. Supply synthetic customer/KYC fixtures, sandbox funding/reset instructions, supported scheduling behavior and expected certification scenarios. No real customer identities or funds are needed for this phase.

## Durable intake and processing design — not implemented

- Keep raw request bytes bounded before decoding; verify the agreed signature representation before parsing or database access. Never log raw bodies, signatures, secrets, bank/KYC fields or provider response bodies. Parse verified events with versioned Zod schemas before database operations.
- Bind the receiver to a configured staging business/account in server-owned configuration. Resolve provider wallet and customer identifiers through a server-created mapping to merchant, customer and savings goal. Never accept a body merchant ID, client balance or caller-selected provider account as authority. Quarantine unmapped or conflicting identities without changing balances.
- Use an append-only migration for an isolated staging inbox with RLS, restricted worker permissions and a unique key scoped by environment, provider account and eventId. Atomically persist the validated event and processing work before acknowledgement. Restrict payload retention/access; store only required data. No new service-role exception is granted by this document.
- Duplicate delivery must return the agreed acknowledgement only after confirming the durable record exists. Same eventId with different authenticated content becomes a conflict requiring investigation. A payload hash alone cannot prove a logical duplicate; use the provider identity contract.
- Process with transactional claims, expiring leases, bounded attempts and dead-letter state. Atomically record the ledger effect and completion marker; a worker crash between them must not double credit. Handle concurrent deliveries, reordered events, retries and restarts. Never use an in-memory Set as durable idempotency.
- Signature validity alone does not prevent replay. Use provider-confirmed signed time/nonce rules if available, plus durable event and transaction deduplication. Do not invent a timestamp header or reject delayed legitimate events using a guessed window.
- Reconcile pending/uncertain transfers against authoritative provider reads under the mapped staging account. Persist outgoing idempotency references before any request. Timeout means unknown outcome: query before another attempt. Check reference, wallet ownership, amount, currency and allowed transition before a ledger update. Keep accrual distinct from posted interest.
- Feed confirmed outcomes into a dedicated savings adapter; existing Paystack behavior stays intact. The client can request actions but cannot set balances or mark a contribution settled. Fulfilment must depend on reconciled available funds and existing release rules.

Required tests before activation: signed provider vectors, raw-byte edge cases, schema errors, unknown events, forged tenant mappings, duplicate and conflicting IDs, concurrent intake, storage outage, process restart/lease expiry, reordered statuses, reconciliation mismatch, missing secrets and production-environment rejection. Durable behavior requires local database integration tests, not only mocked callbacks.

## Staging deployment prerequisites and approval gate

1. Owner approves the concrete target hosting project/domain and configuration diff. Inspect the target first; do not infer staging from a hostname or `NODE_ENV` (staging builds also use production mode).
2. Provision an isolated staging database and narrowly scoped ingestion/worker identities. Confirm project/account allowlists, synthetic-only records and no shared production credentials or job schedules. Register explicit staging-only secret names once approved; never fall back to generic production credentials or a default production API URL.
3. Resolve provider contract gaps; implement durable intake, reconciliation and the environment allowlist. Review and pass the activation test suite before changing GET to 200. Keep production disabled regardless of host headers.
4. Approve DNS/TLS, deployment protection and secret configuration changes. Use the repository's approved prebuilt deployment flow; no cloud build or deployment was performed here. Do not run `vercel build`.
5. Verify public DNS, certificate, exact-path GET 200 and POST handling from outside the environment. Check middleware, request-size/rate limits, no-store responses and log redaction. Obtain explicit provider registration confirmation.
6. With separately authorized sandbox operations, run synthetic funding/transfer/interest scenarios, replay/outage tests and balance reconciliation. Record deployment SHA, provider event IDs and test outcomes without secrets or sensitive payloads. Production activation needs a separate owner decision.

## Validation

The two new test files passed: 16 synthetic tests. `pnpm turbo lint && pnpm turbo typecheck` passed (existing lint warnings remain).

`pnpm turbo test` completed with five package tasks passing and one failing. Web: 5,385 test files / 33,415 tests passed, one todo, one failed test. The failure is `tools/cost/cloudflare-evidence-process-isolation.test.ts`: its prepare command rejects this uncommitted worktree with `tooling worktree is not clean`. No attempt was made to bypass its safety check or commit files to satisfy it. Therefore the full repository quality gate is not green. Log: `/private/tmp/piggyvest-preparation-tests.log`.

The first pnpm validation automatically installed this worktree's dependencies from the lockfile and ran package postinstall hooks (including shared Git hook synchronization); no tracked dependency/configuration edits were requested. CodeRabbit review was not run; no commit, PR or deployment was made.

## Suggested WhatsApp update — draft only

“We’ve found the Business Wallets API documentation and prepared the local webhook foundation. The proposed staging URL is not reachable yet, so it is not ready for registration. Please confirm staging profiling and secure credential delivery to j.bassey@ogabassey.com, and share signed webhook samples plus retry/redelivery details. We’ll confirm the endpoint once staging deployment and verification are complete.”
