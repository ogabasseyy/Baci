# Wallet route repair — 24 September 2026

## Verified

- Owner diagnostic: gateway active; four wallet REST resources and payment-settings RPC absent from its allowlist.
- Isolated database read-only preflight: 32 authenticated column permissions, four wallet tables with RLS and ownership-policy predicates, and settings RPC execution present. Anonymous wallet and transaction queries returned zero rows. No grants or migrations changed.
- Targeted Python suites: 26 tests passed, including route preservation, package pinning, retry safety, activation rollback and fresh evidence restoration. Proxy transformation: three Vitest tests passed. Workspace typechecks passed; workspace lint remains failing outside this repair scope.
- Vercel candidate preserves webhook function bytes and existing routes. No Vercel deployment performed for this repair yet.

## Owner activation

Run on the Mac:

```sh
/bin/sh /private/tmp/baci-wallet-fix-20260924-reviewed.sh
```

The command copies checksum-pinned source into a root-only directory, verifies the complete file set before execution, builds the exact 11-to-16 gateway route extension, runs its preflight, activates with rollback protection, and adds the exact general-wallet GET Nginx route. It preserves the September 29 deadline, environment, credentials and existing application services. It restarts the staging gateway and reloads Nginx. Root-only backups and the reviewed code remain available for recovery.

Expected final marker: `STAGING_WALLET_GATEWAY_AND_NGINX_READY`.

If any stage fails, retain the output and do not run old recovery scripts or repeatedly retry. The reviewed wallet-specific recovery replaces the old 5/11-route recovery for this transition.

## Remaining verification

After successful owner activation, verify authenticated general-wallet access directly through staging-auth, then deploy the preserved prebuilt proxy candidate to the dedicated staging Vercel project and repeat authenticated reads through staging.ogabassey.com. Check authentication rejection, cross-merchant denial and webhook preservation. Only then reload the intended Metro worktree and test the phone wallet. Route health does not establish funding, interest settlement or complete financial end-to-end validation.

Prepared proxy candidate: `/private/tmp/baci-wallet-proxy-20260924-fmYpdB`.

## Activation and public verification

Owner activation completed with `STAGING_WALLET_GATEWAY_AND_NGINX_READY`; the fixed lease remains unchanged. The preserved prebuilt artifact was deployed to the dedicated staging project as `dpl_GBjPR9eaFg4FUneTNmDypFQfuKNc`, aliased to `staging.ogabassey.com`.

Fresh synthetic-customer authentication and public GET requests returned 200 for general wallet, savings goals, and PiggyVest plan-wallet funding-account reads. Unknown merchant returned 404; unauthenticated wallet GET returned 401; wallet POST returned 405. Webhook registration GET remained 200. This verifies the previously missing wallet routing, not provider settlement or a completed phone interaction.
