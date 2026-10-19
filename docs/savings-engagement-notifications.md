# Savings earnings and engagement notifications

## Money semantics

`Earnings` is cumulative customer-eligible, booked savings interest less explicit reversals. It is not the wallet balance, principal contributions, pending interest, the platform's interest share, or a promise based on the dashboard rate. Funding and checkout continue using spendable wallet balance. Earnings is not added to the total a second time.

The authenticated `get_customer_savings_earnings(merchant)` RPC reads the canonical savings ledger. Missing RPCs and old hosted-wallet responses show earnings as unavailable, not zero and never as wallet top-ups. This implementation neither sets PiggyVest's interest split nor treats raw provider payouts as customer entitlement. A booked `credit_eligible_paid_interest` operation is required.

## Notifications

- Confirmed interest, first contribution, highest milestone crossed (25/50/75/90/100), three consecutive contribution periods, and completion.
- Gentle overdue reminders after a 24-hour grace period, with month-end scheduling. Recovered contributions suppress queued overdue pushes.
- Optional Monday summary of the previous week's confirmed contributions.
- Persistent, customer/merchant-scoped inbox, read status, preference controls, quiet hours, and time zone.
- Existing local reminders remain the fallback until an authenticated inbox response explicitly reports server delivery enabled. That capability is isolated by API origin, merchant, and signed-in user; staging cannot disable another account's reminders.
- Default quiet hours: 10 PM–8 AM Africa/Lagos. Weekly summaries default off. Encouragement and interest alerts can be disabled independently.
- One encouragement push per customer/merchant per 24 hours. Financial interest alerts are separate. Multiple devices can receive the same event; other goals cannot bypass the daily cap.
- Unique event keys and transactional claims prevent webhook/scheduler replays from creating duplicate dispatches. Paused/cancelled plans do not receive encouragement pushes.

The worker records a dispatch claim before calling Expo. Unknown outcomes and crashed dispatches are not automatically resent; the inbox remains available. This intentionally prefers avoiding duplicates over guaranteeing every push. Expo ticket acceptance is not device delivery. Receipt checks start after 15 minutes; missing receipts become unknown after 24 hours. Confirmed `DeviceNotRegistered` receipts disable only the matching customer's storefront token. See [Expo delivery documentation](https://docs.expo.dev/push-notifications/sending-notifications/).

## Deployment gates — not automatically applied

1. Apply the four new migrations, in order, after existing canonical ledger migrations: `20260925130000` storage, `20260925130100` events, `20260925130200` delivery, and `20260925130300` receipts. No historic earnings or notification events are fabricated/backfilled.
2. Deploy the updated wallet route and `/api/storefront/customer/savings/notifications` GET/PATCH route. In the isolated staging gateway, explicitly allow the new endpoint and authenticated earnings/inbox/preferences/read RPCs; do not broaden the REST allowlist or expose the private schema.
3. Provision credentials for the dedicated `baci_savings_notifications_worker` role. It is created NOLOGIN with no table grants; an operator must enable a restricted login separately. Do not use a service-role key or postgres/admin connection.
4. Configure server-only `SAVINGS_NOTIFICATIONS_DATABASE_URL` and `SAVINGS_NOTIFICATIONS_DATABASE_NAME` in the restricted worker, not the user-facing API service. Preserve TLS verification. The HTTP cron also requires `CRON_SECRET`; a systemd worker does not. Provision Expo push credentials for the app and optionally `EXPO_ACCESS_TOKEN` when Expo enhanced push security is enabled. Never expose secrets through `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*`.
5. Only enable `SAVINGS_NOTIFICATIONS_ENABLED=true` after staging identity, grants, and authenticated database checks pass. The worker defaults disabled. Separately set API capability `SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED=true` only after the worker and schedule are healthy. The cron is `/api/cron/savings-notifications`, scheduled every 15 minutes in root `vercel.json`; the isolated VPS uses a restricted systemd worker and its own 15-minute timer. Neither API capability nor a successful empty worker run proves physical-device delivery.
6. Verify a synthetic completed contribution and a canonical eligible-interest credit appear once in the inbox. Repeat the event and cron, test quiet hours and opt-outs, and verify the earnings amount independently. Do not send real-money provider requests to manufacture a notification.
7. Register a staging customer's physical-device push token with existing permission controls. Confirm the push opens the savings wallet, check the receipt separately, switch accounts to test inbox isolation, and test denied permissions (inbox still works).

No production configuration, migration, provider split, or device-delivery claim follows from local tests passing. Staging activation adds only reviewed exact routes and preserves the existing lease deadline.

## Local verification

Run against a local disposable Supabase Docker container, not the live VPS:

```sh
python3 tools/test/savings-notifications-postgres.test.py --container supabase_db_baci-savings-local-lfikp5
```

The runner creates and removes only a uniquely named scratch database. It uses minimal synthetic application tables plus the actual canonical ledger table migration and the new migrations. It tests money separation, scoping/grants, quiet hours/DST, month ends, reversals, receipts, stale reminders, crash recovery, and eight concurrent claimers. This is not a full historical migration replay or a provider settlement test.

Focused Jest/Vitest suites are colocated with the mobile inbox, schemas/services/hooks, wallet earnings helpers, authenticated route, cron, and Expo worker. Broad lint/typecheck results must distinguish pre-existing dirty-worktree issues from failures introduced by this feature.

## Verification snapshot — 25 September 2026

- Focused mobile run: 21 suites / 119 tests passed, including the notification route-shell regression. A final contract run added four schema cases and passed 23 tests across four suites.
- Focused web/API/worker/replay-manifest run: 12 suites / 138 tests passed. Shared earnings helper/schema: 13 tests passed.
- Real PostgreSQL rehearsal and eight parallel pre-expanded delivery claimers passed. Only temporary local databases were used; no provider or production money movement occurred.
- Broad repository tests are not green: mobile reported 8 failing suites during integration; the new notification route-shell failure was subsequently fixed and rerun green. Remaining failures include existing storage/bootstrap, Expo-compliance, and savings submission fixtures. The broad web run also encountered existing replay/tooling failures and was interrupted when Turbo stopped on the mobile failure.
- Full typecheck still reports two unrelated mobile test-fixture errors: `format-date-time-display.test.ts` and `run-savings-goal-submission.idempotency.test.ts`. No new-feature type errors remain. Scoped Biome checks pass; the full repository still has unrelated lint findings.
- Metro on port 8082 is running from the design worktree. Unauthenticated public staging wallet returns 401; the new notifications endpoint returns 404. Therefore server deployment, migration/worker activation, and physical-device push receipt verification remain pending. Do not describe this snapshot as live phone notification success.

## Staging activation follow-up — 25 September 2026

- The four feature migrations are now applied to the isolated PostgreSQL cluster `7685292944002592802`, database `postgres`. A private pre-migration dump was retained. Authenticated earnings, inbox, preferences, cross-merchant rejection, and restricted-worker grants passed a transaction-rolled-back SQL verification. No balances or historical events were fabricated.
- Dedicated Vercel project `ogabassey-piggyvest-staging` now serves deployment `dpl_CDYwFLFQVCJvHKfWpXkijeQvGuHR`. It preserves the receiver bytes and previous routes and adds only the notifications GET/PATCH proxy and method rejection. Wallet/goals/drafts remain 401 without authentication; the webhook GET probe remains 200. The new upstream route remains unavailable until owner activation.
- A new offline-compiled funding artifact passed loopback auth-boundary checks. Deployment helpers in `tools/staging/savings-engagement` prepare and verify the candidate before stopping anything, retain the old artifact for rollback, add six exact gateway routes, install the restricted worker inactive, and activate the schedule only after a successful worker run. The fixed deadline remains 29 September 2026, 15:59:10 UTC.
- Metro transport permits only the official Expo token-registration endpoints and exact staging notification operations. Push-token registration remains authenticated and merchant-validated; deactivation has only the `is_active` column grant and own-active-token RLS. Actual phone registration and delivery still require verification after root activation.
- Full lint/typecheck remain blocked by unrelated existing mobile files. Focused API/CLI, mobile transport, SQL, and deployment-helper tests are reported separately; no production deployment occurred.
