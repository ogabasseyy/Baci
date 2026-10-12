# Isolated wallet test payments

This optional staging service enables Paystack **test-card** funding of the
approved synthetic customer's existing wallet, followed by the existing manual
savings contribution route. It does not enable production payments, transfer
real money to PiggyVest, create synthetic balances, or change interest policy.

## Boundaries

- VPS service: `127.0.0.1:4897`, separate unprivileged service account.
- Auth: public staging Supabase client verifies the customer's bearer token.
- Database: cluster `7685292944002592802`, database `postgres`, dedicated role
  with function-only permissions. No service-role key is used.
- Merchant/customer IDs are pinned to the existing synthetic fixture.
- Only `sk_test_` credentials are accepted. Server-side verification must match
  test domain, successful status, reference, amount, NGN, and customer email.
- Settlement locks the durable intent and credits through the canonical wallet
  function atomically. A second confirmation cannot add a second credit.
- The fixed deadline remains **29 September 2026, 15:59:10 UTC**. Startup,
  individual requests, SQL functions, and a systemd timer enforce it.
- Existing PiggyVest webhook code is copied unchanged. This slice does not add
  Paystack webhook ingestion; wallet confirmation performs settlement.

## Activation order

1. Build `apps/web/tools/staging-wallet-payments/main.ts` with esbuild for Node 24.
2. Run `package.py` with the reviewed public staging profile, compiled server,
   legacy reviewed helper worktree, and a new output directory. It derives all
   archive and installer hashes from the actual files, rather than reusing old
   build pins. No secret is included in the archive or shell wrapper.
3. Upload the archive and bootstrap to the exact location declared by
   `bootstrap.py`, owned by `bassey` with mode `0600`.
4. The owner runs the generated `reviewed.sh`. The hidden prompt accepts the
   Paystack test secret locally; the database password is generated on the VPS.
   The installer provisions only this service and its restricted staging role,
   adds the one manual-contribution RPC to the 22-route gateway, then adds three
   exact POST Nginx routes. It preserves the existing lease.
5. Verify authenticated initialize/confirm and manual savings contribution. A
   `401` readiness probe alone does not prove payment success.
6. Deploy the prepared Vercel proxy with `vercel deploy --prebuilt --prod` only
   in project `ogabassey-piggyvest-staging`; verify the staging alias and unchanged
   PiggyVest receiver. Never deploy this proxy to the production commerce project.
7. Restart the correct Metro worktree with
   `EXPO_PUBLIC_STAGING_TEST_PAYMENTS=1` only after those routes are verified.
   The mobile capability also requires both pinned staging origins and hosted
   staging mode. Preserve the existing login/session.

## Verification and recovery

The SQL rehearsal uses the real canonical credit function inside a transaction
that is rolled back. Post-rollback wallet/ledger counts and balance must remain
unchanged. A later successful provider test payment is a separate live gate.

Run each `*.test.py` explicitly: their dotted filenames are not discovered by
Python's default `unittest discover` pattern. Run the colocated Vitest tests for
the server and Jest tests for the mobile gate. Check the dedicated server
`tsconfig.json` as well as the repository quality gates.

Keep owner receipts and backups after any refusal. Do not delete or recreate the
existing funding/drafts artifacts, weaken the gateway checks, or extend the lease
to make an installation pass. A gateway-applied failure is deliberately retained
for owner review, as is any failure after database provisioning starts. A matching
pre-database failure can recover only its own verified files and must not discard
any top-up intent. Never blindly rerun after a `database`, `service`, `gateway`,
or `nginx` refusal; inspect the retained owner receipt first.

If the installed payment service is healthy but its Nginx routes were reverted,
`package.py --recover-nginx` creates a separate sealed route-recovery bundle.
It never invokes service installation or database provisioning. It requires the
exact saved Nginx predecessor or its rendered three-route successor, validates
the running service and fixed deadline, checks existing routes, then verifies
15 seconds of route and configuration stability. The recovery lock serializes
its own invocations, not arbitrary external root writers. Keep the mobile test
capability off until independent public-route checks pass.
