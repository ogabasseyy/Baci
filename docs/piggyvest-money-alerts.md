# PiggyVest Money Alerts

Every PiggyVest money path that refuses, holds or parks money for a person to
look at raises an alert. Alert codes are declared once in
`apps/web/src/lib/piggyvest/webhook-alerts.ts` (`PIGGYVEST_WEBHOOK_ALERT_CODES`);
other code only emits codes declared there.

## Two channels

| Channel | What it is | Guarantee |
| --- | --- | --- |
| Console line | `[PiggyVest Webhook][ALERT] <CODE> {detail}` on the server log | Always written, once per alert. The log drain pages on the prefix and routes by code. |
| PostHog event | Server-side `piggyvest_money_alert` | Best effort. Sent after the console line, deduped, bounded by a timeout. |

The PostHog event is a second channel, not a replacement. When PostHog is
down, slow, unconfigured or throws, the console line is still written and the
caller's reply (HTTP status, body and headers) is exactly the same.

## PostHog event properties

Only these properties are sent. Each comes from the same allowlisted detail as
the console line.

| Property | Meaning |
| --- | --- |
| `code` | The alert code (table below) |
| `deployment_environment` | `production`, `preview` or `development`, so paging can ignore non-production traffic |
| `key_version` | Version label of the webhook signing key involved, never the key itself |
| `reason` | Short internal explanation, at most 120 characters |
| `capture_id` | Internal id of the stored webhook delivery |
| `event_type` | PiggyVest event type of that delivery |
| `attempts` | How many processing attempts were made |
| `operation_id` | Internal id of the transfer or ledger operation, for alerts that have no capture |

The server PostHog helper also stamps `app_surface` and `runtime`.

Never sent: request bodies, signatures, key material, customer names, emails,
phone, account or card numbers. Identifier fields that are not plain
identifiers are dropped. Emails and runs of seven or more digits inside
`reason`, including digits grouped by single spaces or dashes, are replaced
with `[Filtered]`.

## Delivery rules

- **Fire-and-forget.** The send never throws or rejects and is bounded by a
  2-second timeout (the shared server capture has its own 3-second bound). On
  Vercel the invocation is kept alive until the send settles; elsewhere the
  keep-alive does nothing.
- **Dedupe per capture and code.** Within one server instance, the same code
  for the same `capture_id` is sent once. Alerts with no capture use
  `operation_id` instead. Alerts with neither (for example a missing key
  configuration) are sent at most once per code and key version every 10
  minutes. Each event id is derived from the dedupe key, so copies sent by
  other instances share one id and are easy to group. PostHog itself only
  drops an exact duplicate (same id and same timestamp), so another instance
  can still send its own copy: expect at most one page per instance, never
  fewer than one.
- **A failed send can retry.** If PostHog fails or times out, the dedupe slot is
  released and the next occurrence of that alert is sent again.

## Codes

| Code | What happened | First check |
| --- | --- | --- |
| `PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED` | No usable webhook signing key is configured, or the loaded key set is incomplete. Deliveries get 503 or are deferred | Server key configuration |
| `PIGGYVEST_WEBHOOK_KEY_REVOKED` | A delivery was signed with a key revoked for new requests. It got 401 and nothing was stored | Key rotation status with PiggyVest |
| `PIGGYVEST_WEBHOOK_CAPTURE_FAILED` | A signed delivery could not be stored. It got 503 so PiggyVest redelivers | Database health |
| `PIGGYVEST_WEBHOOK_PROCESSING_DEFERRED` | A stored delivery failed processing and is kept for retry | Worker logs for the capture |
| `PIGGYVEST_WEBHOOK_REPLAY_UNVERIFIABLE` | A stored delivery could not be re-verified on replay and was parked | Key archive for that key version |
| `PIGGYVEST_WEBHOOK_NEEDS_REVIEW` | A stored delivery was parked for a person to review | The capture's review reason |
| `PIGGYVEST_WEBHOOK_REPLAY_DEFERRED` | The worker-host capture drain set a stored delivery aside for review because only the legacy path can finish it. A successful PiggyVest redelivery still closes it | Whether PiggyVest redelivered it; see docs/piggyvest-webhook-capture-drain-runbook.md |
| `PIGGYVEST_TRANSFER_NEEDS_REVIEW` | A transfer is still unconfirmed past its retry window. It is held, never resent or released. Also used for any stale unconfirmed transfer | Transfer status at PiggyVest for the operation |
| `PIGGYVEST_PRIMARY_ROUTING_NEEDS_REVIEW` | A new main wallet's interest routing was contradicted, at onboarding or on a later recheck. It is kept rejected and never usable; its settings are fixed at creation | The intent's wallet routing at PiggyVest |
| `PIGGYVEST_PRIMARY_OWNERSHIP_NEEDS_REVIEW` | A retried onboarding found a PiggyVest customer it could not prove ours: several customers under our identifier, a duplicate, or an existing customer not listed under it. Nothing is adopted | Customers carrying the intent's identifier |
| `PIGGYVEST_RESTRICTION_BLOCKED` | A spend or transfer was refused because PiggyVest reports a freeze or lien on the wallet | Wallet restriction status |
| `PIGGYVEST_INTEREST_BACKFILLED` | The daily reconciliation recorded an interest payout the webhook never delivered (once, by PiggyVest transaction id) | Why the webhook was missed |
| `PIGGYVEST_FEE_UNATTRIBUTED` | A deposit fee could not be matched to the wallet balance change; the credit is held | The deposit's provider record |
| `PIGGYVEST_MAIN_WALLET_INTEREST_MISROUTED` | Main-wallet interest landed in a main wallet instead of the Interest house wallet; held, never credited or swept | Interest routing for that wallet |
| `PIGGYVEST_GOAL_INTEREST_MISROUTED` | Goal interest landed outside its goal, or the goal opted out. It is the customer's money; support resolves it | Goal routing; support procedure |
| `PIGGYVEST_ENGINE_CREDIT_NOT_BACKED` | A confirmed transfer credited a wallet that is not yet PiggyVest-backed; the backed balance waits for the wallet to switch | Wallet switch status |
| `PIGGYVEST_INFLOW_REVIEW_OPEN` | A wallet is above its expected balance by exactly its open inflow reviews; nothing is re-queued | Open inflow reviews for the wallet |
| `PIGGYVEST_INFLOW_UNMAPPED` | A bank deposit arrived for a PiggyVest wallet that maps to none of our goals or wallets. It is not credited and stays retryable. Goal account numbers are hidden in the app, so this is unexpected. Raised once per provider transaction id (the event id for other event types) per server instance on the primary log channel (the console line, remembered as soon as it is written); the PostHog page is best effort, and a failed or timed-out send is retried on the next redelivery without repeating the log line. A restart, or another instance, can page once more: the log page is once per deposit per server instance, and PostHog is deduplicated across instances | The event's wallet and customer at PiggyVest; whose money it is |
| `PIGGYVEST_NEGATIVE_DRIFT` | Reserved for drift monitoring: the PiggyVest balance is below what our records expect and new spends are held. Not emitted yet | Drift report for the wallet |
| `PIGGYVEST_RECONCILIATION_MISMATCH` | The daily reconciliation found a transfer still reserved or sent past its cutoff, a goal wallet holding less at PiggyVest than we recorded, a balance it could not read, or it could not run. The emailed report lists each one. Read-only: nothing is resent or released | The emailed report, then the status of each listed transfer at PiggyVest |
| `PIGGYVEST_GOAL_CANCEL_NEEDS_REVIEW` | A goal cancel cannot finish by itself. Either the goal also holds legacy contributions or order redemptions (reason `legacy_funds_on_primary_goal`: nothing was sent, the goal is unchanged), or PiggyVest moved the refund but the database refused to settle it (reason `settle_conflict` or `release_conflict`, or `settle_balance_mismatch` when the post-transfer balance read answered about a different wallet and nothing was concluded, for example a late success while a newer attempt is live). Since the early-cancel split: `provider_balance_below_principal` (PiggyVest held less than the saved principal; nothing was sent and the attempt is released) and `split_inconsistent` (the database answered a split that does not add up to the balance read; the database checks prevent this, it is defence in depth). Nothing is resent or released | The cancel operation id in the alert, then its status at PiggyVest; for a conflict, settle the attempt by hand once the other attempt is resolved. A settled attempt that left money behind (a residual provider balance, or funding after the dispatch) sits in the `needs_review` state: the refund is credited, the goal stays open, and a new cancel is blocked until you clear it. Clear it with `SELECT public.clear_goal_cancel_review('<operation id>', '<what you checked>');` as the service role (ops tooling only). It moves the attempt to the terminal `reviewed` state and the customer can cancel again; the new attempt takes a fresh numbered reference and sweeps what is left. For `provider_balance_below_principal`, the goal is held (no new cancel starts): compare the goal's `current_amount` with PiggyVest's goal wallet balance, correct whichever is wrong, then clear the hold with `UPDATE piggyvest_primary.goal_cancel_operations SET held_reason = NULL WHERE id = '<operation id>';` (owner SQL). If an early cancel settles into review because an interest payout landed at the same moment (the residual equals that payout), the customer's principal is already back: plan the forfeit by hand for the residual (or move it to Ogabassey's interest wallet in PiggyVest's dashboard) and clear the review. For `split_inconsistent` the attempt is left `dispatched` with nothing sent: confirm at PiggyVest that no transfer exists under its reference, then release it with `SELECT piggyvest_primary.manage_goal_cancel('<scope>', '<operation id>', 'release', 0);` as the executor login (or ask an engineer) |
| `PIGGYVEST_GOAL_CANCEL_FORFEIT_NEEDS_REVIEW` | The interest leg of an early goal cancel (interest forfeited to Ogabassey's interest wallet, owner decision 2026-11-12) cannot finish by itself. The customer's saved money is already back in their main wallet and their cancel reads confirmed; only Ogabassey's interest is affected. Interest PiggyVest pays into a goal wallet after the cancel is planned is forfeited too (an extra forfeit is planned automatically). Reasons: `forfeit_rejected_three_times` (PiggyVest definitively refused three forfeit references; nothing moved), `forfeit_overdue` (the daily sweep found a forfeit still in flight a day after it was sent), `forfeit_needs_review` (first report of a forfeit already in review), `goal_wallet_short` (before sending, the goal wallet was not the customer's active NGN wallet in this business or held less than the interest; nothing was sent and the forfeit was handed back), `settle_conflict` / `settle_failed` / `release_conflict` / `release_failed` / `settle_balance_mismatch` (PiggyVest answered but the database refused to conclude, or money was left in the goal wallet after the forfeit). Paged once per forfeit: `alerted_at` is set only after a page was emitted, so a lost page repeats (a review is re-paged by the daily sweep until acknowledged; expect at most one duplicate) | Look the forfeit up by the cancel operation id: `SELECT id, cancel_operation_id, state, reference, amount_kobo, destination_wallet_id, provider_transaction_id, dispatched_at, posted_at FROM piggyvest_primary.goal_cancel_interest_forfeits WHERE cancel_operation_id = COALESCE((SELECT cancel_operation_id FROM piggyvest_primary.goal_cancel_interest_forfeits WHERE id::text = '<operation id>'), '<operation id>'::uuid) ORDER BY reserved_at;` (owner SQL). The alert's operation id is the cancel attempt for `forfeit_*` and `interest_wallet_*` reasons and the forfeit itself for `settle_*` / `release_*` reasons, so the query matches either. Reasons also include `forfeit_over_ceiling` (a merge would pass the per-transfer limit; nothing was truncated) and `forfeit_needs_review` paged by the daily sweep (the sweep records a page only after emitting it, so a crashed run pages again next day; this also covers a cancel whose interest alone was above the per-transfer limit: the principal went back, the interest sits in a review forfeit whose `amount_kobo` is the limit marker and `goal_cancel_operations.forfeited_interest_kobo` holds the real total). Check each reference at PiggyVest. If an interest transfer landed, record it by hand; if none did and the goal wallet still holds the interest, move it to the interest wallet in PiggyVest's dashboard (or ask PiggyVest why the transfer is refused, for example a fee or a wallet restriction). A balance left after a settled forfeit means the goal wallet received money after the cancel: treat it like a cancel residual |
| `PIGGYVEST_GOAL_CANCEL_FORFEIT_UNAVAILABLE` | An early cancel owes interest but Ogabassey's interest wallet is not configured or not enabled. Holds (`interest_wallet_missing`, and on the needs-review alert `provider_balance_below_principal` and `principal_above_transfer_limit`, the last meaning the saved amount alone is above one transfer, so the customer must be refunded by hand) are paged at submit and again by the daily sweep, at most once a day, until the hold is cleared; clear any of them with the same `held_reason = NULL` statement. Earnings deduct a cancel's forfeited interest only once the cancel is `confirmed`; a cancel cleared to `reviewed` leaves the goal's interest counted in the customer's Earnings, so take that into account when resolving it. Reason `interest_wallet_missing` at submit: the cancel was refused before anything moved and the goal is held (the customer is told it is under review; no new cancel starts): set up the wallet, then clear the hold with `UPDATE piggyvest_primary.goal_cancel_operations SET held_reason = NULL WHERE goal_id = '<goal id>' AND held_reason = 'interest_wallet_missing';` (owner SQL). Reason `interest_wallet_check_failed`: the ownership check could not run (a PiggyVest or network outage); nothing was sent and it is retried. Reason `interest_wallet_not_ours`: the configured wallet failed the ownership check before sending (not this business, the customer's own wallet, or not an active NGN wallet); nothing was sent and the forfeit was released for a fresh reference, so fix the configuration. Reason `interest_wallet_disabled` after the principal was confirmed: the customer's money is back, the interest stays in the goal wallet until the wallet is enabled again (paged once per forfeit) | Configure (or re-enable) the wallet, owner SQL: `INSERT INTO piggyvest_primary.goal_interest_forfeit_wallets (integration_id, provider_wallet_id, enabled) VALUES ('<integration id>', '<Ogabassey PiggyVest wallet id>', true) ON CONFLICT (integration_id) DO UPDATE SET provider_wallet_id = EXCLUDED.provider_wallet_id, enabled = true, updated_at = clock_timestamp();`. The wallet must be Ogabassey's own business wallet, never a customer's, and the deployment settings `PIGGYVEST_INTEREST_WALLET_ID` (the same wallet id) and `PIGGYVEST_INTEREST_WALLET_OWNER_ID` (the PiggyVest customer id that owns that wallet) must match it: nothing is sent while the two disagree (reason `interest_wallet_not_ours`). A stranded forfeit is sent by the daily worker sweep (`/api/cron/piggyvest-goal-cancel-forfeit-sweep`, run right after the daily reconciliation) or the customer's next cancel status check, but only while PiggyVest savings are switched on |
| `PIGGYVEST_GOAL_COMPLETE_NEEDS_REVIEW` | A goal complete cannot finish by itself. Either the goal also holds legacy contributions or order redemptions (reason `legacy_funds_on_primary_goal`: nothing was sent), or PiggyVest moved the balance but the database refused to settle it (reason `settle_conflict`, `release_conflict`, `settle_failed`, `release_failed` or `settle_balance_mismatch`). Nothing is resent or released. A settled attempt that left money behind sits in `needs_review`: the transfer is credited, the goal stays open and no purchase request exists | The complete operation id in the alert, then its status at PiggyVest. Clear a review with `SELECT public.clear_goal_complete_review('<operation id>', '<what you checked>');` as the service role (ops tooling only); the customer can then complete again |
| `PIGGYVEST_GOAL_PURCHASE_REQUEST` | A customer completed a goal: the balance is in their main wallet and a purchase request is saved. Fulfil the purchase by hand. Written once the request is saved; if the write or the mark fails it is repeated on the next status check. The detail carries the operation id only, never customer data | List open requests with `SELECT public.list_open_goal_purchase_requests(100);` as the service role (it shows the goal title, target, customer and whether the alert was sent). After you finish the order, record it with `SELECT public.fulfil_goal_purchase_request('<request id>', '<what you did>');` |
| `PIGGYVEST_CREDIT_AUDIT_DRIFT` | A redelivered inflow or interest credit matched a recorded one on `pvb_reference` (same customer, wallet and amounts) but its audit-only eventData fields differ (the reason names the fields, never values). It was deduped, never credited twice. PiggyVest says `pvb_reference` is the unique credit key (2026-11-11), so this is expected only if their internals drift on retry | Look the credit up by the `operationId` (the `pvb_reference`) in `piggyvest_inflow_credits` / `piggyvest_interest_payouts` and in PiggyVest's transaction list. If PiggyVest shows two distinct credits under one `pvb_reference`, raise it with PiggyVest and credit the missing one manually; otherwise no action. Paging is once per `pvb_reference` per server instance, so restarts or several instances can repeat it: a second page for the same reference is not a new incident until the ledger shows otherwise |

## Setting up paging in PostHog (owner step, later)

This change only sends events. Turning them into pages is a PostHog setting
the owner approves separately; nothing in production is changed here.

1. Confirm `piggyvest_money_alert` events appear in PostHog after PiggyVest
   paths have run in a test environment.
2. Create a trend insight on `piggyvest_money_alert`, filtered to
   `deployment_environment = production`, broken down by `code`.
3. Add an alert on that insight: notify when the count is above 0 in an hour.
   For instant pages, add a destination (Slack or email) for the same event
   and filter instead.

## How it stays switched off

The event fires only when a PiggyVest money path runs, and those paths stay
behind their existing flags. It uses the existing server PostHog project
token; with no token configured nothing is sent and only the console line is
written. No new flag, setting or migration is involved.

## Adding a code

Add it to `PIGGYVEST_WEBHOOK_ALERT_CODES` with a one-line comment, add a row to
the table above, and update the expected list in `webhook-alerts.test.ts`.
Never put request bodies, secrets or customer data in the alert detail.

## Accepted noise: unmapped alert on first delivery

When a deposit webhook arrives before its mapping commits, the first delivery
raises the unmapped-account alert and the retry then succeeds. That one early
page per deposit is accepted: it is preferred over silence for money that may
really be stranded. Treat an unmapped page that clears on the next delivery as
expected noise, not an incident.
