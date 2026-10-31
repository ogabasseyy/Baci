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
| `PIGGYVEST_TRANSFER_NEEDS_REVIEW` | A transfer is still unconfirmed past its retry window. It is held, never resent or released. Also used for any stale unconfirmed transfer | Transfer status at PiggyVest for the operation |
| `PIGGYVEST_RESTRICTION_BLOCKED` | A spend or transfer was refused because PiggyVest reports a freeze or lien on the wallet | Wallet restriction status |
| `PIGGYVEST_INTEREST_BACKFILLED` | The daily reconciliation recorded an interest payout the webhook never delivered (once, by PiggyVest transaction id) | Why the webhook was missed |
| `PIGGYVEST_FEE_UNATTRIBUTED` | A deposit fee could not be matched to the wallet balance change; the credit is held | The deposit's provider record |
| `PIGGYVEST_MAIN_WALLET_INTEREST_MISROUTED` | Main-wallet interest landed in a main wallet instead of the Interest house wallet; held, never credited or swept | Interest routing for that wallet |
| `PIGGYVEST_GOAL_INTEREST_MISROUTED` | Goal interest landed outside its goal, or the goal opted out. It is the customer's money; support resolves it | Goal routing; support procedure |
| `PIGGYVEST_ENGINE_CREDIT_NOT_BACKED` | A confirmed transfer credited a wallet that is not yet PiggyVest-backed; the backed balance waits for the wallet to switch | Wallet switch status |
| `PIGGYVEST_INFLOW_REVIEW_OPEN` | A wallet is above its expected balance by exactly its open inflow reviews; nothing is re-queued | Open inflow reviews for the wallet |
| `PIGGYVEST_NEGATIVE_DRIFT` | Reserved for drift monitoring: the PiggyVest balance is below what our records expect and new spends are held. Not emitted yet | Drift report for the wallet |

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
