# Local customer draft integration boundary

The current PiggyVest branch originally had the provider plan-wallet routes and legacy active savings-goal routes, but not the separately implemented nonfinancial customer draft flow. Browser testing found a real 404 for the draft API and no savings entry point in the web wallet.

Reuse source from `/Users/mac/Baci-worktrees/cursor-savings-phase1`; do not manufacture another demo or reinterpret the legacy active-goal API as a nonfinancial draft API. The original worktree stays untouched.

## Verified local database contract

Container `supabase_db_baci-savings-local-lfikp5`, database `postgres`, cluster `7684917650710224934`:

- `public.customer_savings_draft_command(p_merchant_id uuid, p_action text, p_input jsonb) RETURNS jsonb` exists and is SECURITY DEFINER.
- The authenticated role can execute the command but cannot INSERT directly into `customer_savings_drafts`.
- Draft-table RLS is enabled.
- One merchant setting is enabled in `local_test` environment.
- Command actions are `create`, `list`, `policy`, `accept`. There is no cancellation or funding action in this contract. Do not pretend that closing a dialog cancels a funded plan.

All customer access must still authenticate the actual test user, enforce CSRF for writes, and resolve merchant/customer ownership in the RPC. The existing handler's local-runtime gate must remain closed outside the loopback development database. No privileged client should replace the authenticated caller.

## Source migration dependencies — not applied by this integration

| Source file | SHA-256 |
| --- | --- |
| `20260913120000_customer_savings_draft_storage.sql` | `cd1b4fadd2b138ef632f1005337280d5cf8e600fecc4aae250969184b39d15a3` |
| `20260913120100_customer_savings_draft_commands.sql` | `55fe0de89c1aa461db79e32d9e8abc5686df4a0745a73006958bdb7edf254cc0` |
| `20260912140000_goal_policy_tables.sql` | `63fc591f97a3231c050a4bd96fc13c77b5758c132767377ad29b6d0c6ba5305a` |

Storage references `piggyvest_goal_policy.terms` and its immutability trigger. The original goal-policy migration also references `piggyvest_staging.integrations`, belonging to the other worktree's older integration architecture. Copying only the two draft migrations would not produce a replayable migration chain; copying that entire financial architecture without review would duplicate the new receipt/ledger integration.

Therefore local UI verification uses the already provisioned synthetic database. Migration-history reconciliation is a separate deployment prerequisite, not permission to alter old migrations, replay them over the existing local database, or deploy this local-only draft route to production. Hosted draft authorization is separately pinned to the isolated VPS and is not inferred from a successful local browser test.

## Isolated hosted draft runtime gate

The application runtime admits the customer draft endpoints only when either the existing non-production loopback Supabase runtime is active, or every hosted staging pin matches: request origin `https://staging.ogabassey.com`, Supabase URL `https://staging-auth.ogabassey.com`, and the SHA-256 of `NEXT_PUBLIC_SUPABASE_ANON_KEY` is `1065d3a5c300f1d3ba3d6c42cbe0524128c57cc2032a4345bff4100cb6f7a3f2`.

Hosted staging additionally requires the server-only `PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED=true` integration flag. This flag has no `NEXT_PUBLIC_` prefix and must never be supplied by a request. `NODE_ENV=production` is an optimized runtime setting, not deployment identity; absent the exact hosted pins and explicit flag, the route remains disabled. A loopback Supabase URL cannot qualify as hosted staging.

Both command and catalogue paths accept only synthetic merchant `10000000-0000-4000-8000-000000000001` after Zod parsing and before database access. This application gate supplements, and never replaces, the installed hosted SQL binding: its database, cluster, merchant, authenticated-user/customer binding, and `hosted_draft_visible` controls must be independently verified by the parent before any activation. No migration is applied or altered by this gate.

Saving a draft and accepting displayed terms do not create a PiggyVest wallet, move funds, lock a device price, earn interest, or fulfill an order. Provider funding, goal activation, reconciliation and financial cancellation remain separate gates.

## Browser verification and fixes

The local development site at `http://127.0.0.1:4194/ogabassey/wallet` now uses the existing HTTP-only storefront session rather than incorrectly expecting browser Supabase tokens. Catalogue reads pass through an authenticated local-only server route. Customer access requires an exact user/merchant match; catalogue GET never links accounts by email or writes ownership.

The browser test selected the synthetic product `10000000-0000-4000-8000-000000000003` and exact variant `10000000-0000-4000-8000-000000000005` (`Blue · 512GB`), saved draft `b6a13138-e80a-4133-8984-b40e3028a9d6`, accepted its draft disclosure, and reloaded the same persisted draft with consent retained. This is real local authentication and database persistence, not a mocked financial transaction.

The local wallet test surface replaces the wallet body only for the explicit synthetic merchant under the local development gate. It is not the shipping customer wallet design. Its test/draft labels deliberately describe the nonfinancial boundary and are not evidence of production activation.

Final parent verification passed **167 tests across 25 savings-related files** through `pnpm turbo test --filter=@baci/web`. Repository typecheck passed after integration. Full repository lint still reports errors outside this UI slice, including existing env/wallet/PiggyVest formatting and the performance-tool empty catch. No full-suite pass is claimed.

Independent review caught and verified removal of the catalogue GET's ownership-mutating email fallback. Regression tests also cover the HTTP-only session branch, changed-user invalidation, request cancellation, catalogue failures and exact variants. Visual inspection caught unreadable local-wallet text against the page background; matching themed background/foreground classes now fix both signed-in and signed-out wrappers. The updated screenshot is `/private/tmp/piggyvest-local-savings-proof-themed.png`; persisted draft evidence is `/private/tmp/piggyvest-local-savings-proof.png`.

No hosted application deployment, schema migration, provider funding or production change occurred in this UI test.
