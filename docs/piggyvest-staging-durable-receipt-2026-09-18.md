# Staging durable webhook receipt — 18 September 2026

## Verified deployment

Dedicated staging Vercel project: `ogabassey-piggyvest-staging`.
Deployment: `dpl_7pJr1MFWx1TKYmT2kQRnfEhFFUxZ`, deployed from prebuilt artifacts and promoted after signed receipt checks. No Baci production deployment or money movement.

Public endpoint: https://staging.ogabassey.com/api/webhooks/piggyvest

- GET: HTTP 200, staging reachability; event processing is quarantined.
- Signed synthetic POST: HTTP 200 only after durable encrypted receipt.
- Public verification receipt: `af206dba-cb09-46e8-ae80-2eca41b85044`; confirmed directly in isolated PostgreSQL with status `quarantined`.
- Identical signed replay: same receipt ID, `duplicate: true`.
- Invalid signature: HTTP 200 with `received: false, invalid: true`; not an accepted event.
- Auth gateway `/auth/v1/health`: HTTP 200 after promotion.

## Storage and security

The receiver verifies raw-body HMAC-SHA512, forwards to a fixed HTTPS intake with a separate integration token, and requires an explicit durable receipt before acknowledgement. The VPS independently verifies authentication and signature, encrypts exact bytes using AES-256-GCM, and writes to a dedicated isolated receipt database. No sensitive payload logging or customer balance changes.

Only intake port 4791 is published on loopback. Database and restricted PostgREST remain internal. The owner-installed Nginx route exposes only `/piggyvest/intake`; existing auth routing is preserved. Installer retains a root-private rollback backup. Earlier inactive managed-gateway work is separate and unchanged.

Private checks proved database outage returns 503, receipt survives database/intake restart, and encrypted storage recovers exact original bytes. Deduplication covers identical raw bytes, not final semantic event or ledger idempotency.

## Validation

- 141 scoped TypeScript tests passed across nine suites.
- 17 installer tests passed; isolated SQL regression rehearsal passed.
- Root typecheck passed; scoped Biome passed.
- Root lint remains blocked by an unrelated empty catch in `apps/web/tools/perf/sitespeed-build-identity.mjs`.
- CodeRabbit major unread-oversized-stream finding fixed with a reproducing regression test. Do not interpret this as a clean final whole-repository review.

## Remaining gates

This milestone supersedes earlier public webhook 503 status, not unfinished wallet integration work. Signed events are durably quarantined, NOT processed into financial balances. Real provider-origin delivery remains unconfirmed: ask PiggyVest to resend one staging delivery and correlate its receipt before claiming provider end-to-end success.

Financial processing requires reviewed event contracts, trusted wallet/customer mapping, semantic idempotency, reconciliation, failure handling and worker activation. Customer savings flows and provider settlement need separate end-to-end validation. No production certification is implied.

Restricted storage JWT expires `2026-10-18T15:40:34Z`; securely renew before expiry. Preserve the encryption key and database volume. Review backup/restore, retention, operational monitoring and replay tooling before broader use. Credentials are deliberately excluded from this document.

## Owner message draft

Thanks for flagging this. We have corrected the staging endpoint and verified signed webhook receipt with durable storage. Please resend one staging delivery so we can confirm receipt end to end. We are continuing the wallet-flow integration.
