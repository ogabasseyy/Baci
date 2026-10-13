# REDVAULT refund recovery completion — 12 September 2026

## Delivered local operator boundary

- `apps/web/src/lib/payments/redvault-refund-recovery-runner.ts` composes the established durable refund claim/submission/reconciliation flow through injected store and provider transports only. Unknown runtime modes reject without applying.
- The runner defaults to `dry-run`, which performs no database claim, provider lookup, submission, or other mutation.
- An apply run requires the literal `apply-redvault-test-refunds` guard and a transport declared as `test`. `createRedvaultRefundRecoveryTestTransport` is server-only and constructs its own RPC client from a local `http://localhost` or `http://127.0.0.1` origin only. It rejects credentials, paths, queries, hashes, remote origins, malformed/restricted-role-mismatched JWTs, non-allowlisted RPC names, redirects, provider failures, and malformed response bodies. It accepts an explicitly supplied `redvault_refund_test` local-audience JWT and never accepts a caller-supplied RPC client. It constructs the provider only through `createTestRedvaultPaystackRefundProvider`, which rejects every key except an `sk_test_` key. Neither module reads environment variables or constructs a live provider/database client.
- Operational logs contain only the fixed event name, operation, and outcome. They omit provider bodies, references, capture identifiers, refund identifiers, and errors.

## Preserved safety properties

- Existing SQL claim fencing and expiry remain the reconciliation authority. The runner passes the claim token unchanged to the existing reconcile RPC.
- A submission response loss remains `processing` and is never resubmitted by this runner; only a persisted provider refund identifier is eligible for read-only reconciliation.
- Existing reserve RPCs retain cumulative original-net limits and persisted unit allocations. This change does not alter their SQL, permissions, or migrations.
- `supabase/migrations/tests/redvault-refund-recovery-test-role.sql` creates a rollback-only `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`, non-superuser `redvault_refund_test` role in a disposable local cluster. It grants `USAGE` on `public` and only the six REDVAULT refund RPC signatures, not `service_role` membership. The native proof inspects each direct function ACL grant, then executes reserve, claim, provider-submission recording, fenced reconciliation claim, and reconciliation as that role. It proves direct private-table reads and an unrelated synthetic RPC remain denied; it does not claim that every pre-existing public RPC is inaccessible.
- No Paystack call, database mutation, remote migration, activation, deployment, or real payment was performed.

## Activation boundary

Production recovery remains unavailable. It requires a separately approved restricted-role transport with grants limited to the existing REDVAULT refund RPC surface, an explicitly reviewed non-test provider-key policy, an authenticated operator entrypoint, and verified Paystack refund/reconciliation evidence. This implementation intentionally does not create a cron route, service-role exception, or environment-based runtime wiring. The local test adapter is not a production database authorization mechanism.

The adapter's JWT claim-shape preflight is not JWT signature or audience verification. A local PostgREST/Supabase gateway must independently verify the supplied test token before honoring its database role; the native PostgreSQL role fixture proves database grants only.

## Local coverage

- `redvault-refund-recovery-runner.test.ts`: dry-run no-mutation behavior, missing apply-guard and invalid-mode rejection, injected test submission/reconciliation, exact fenced claim-token forwarding, and sanitized provider failure handling.
- `redvault-refund-recovery-test-transport.test.ts`: live-key rejection before an RPC claim/provider call; validated local-origin-only RPC URL construction with `redirect: error`; remote, credentialed, path-bearing, query-bearing and malformed-JWT rejection; and strict refund-RPC allowlist coverage.
- `node supabase/migrations/tests/run-redvault-refund-recovery-test-role.mjs`: isolated native PostgreSQL proof passed; it creates and removes its own local cluster, applies the REDVAULT fixture and migrations through `911` plus `913`, then runs the disposable-role fixture without modifying the shared native runner. The fixture uses a pre-tiered snapshot shape, so migration `912` remains covered by its dedicated tiered native runner rather than this authority fixture.
- Existing lifecycle, store, and Paystack adapter tests continue to cover provider binding, ambiguous submissions, reconciliation fencing, and durable RPC calls.
