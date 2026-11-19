# PiggyVest sandbox provider acceptance — 2026-11-08

The existing guarded provider-contract harness completed proof `p10` against
the sandbox with `mockData: false` and status `observed`. Every finding below
was `yes`. This run used separate synthetic provider customers and test money;
it did not use the recording account or enable production payments.

| Finding | Result |
| --- | --- |
| `s8_onboard_customer_and_main_wallet` | yes |
| `s8_goal_wallet_created` | yes |
| `s8_deposit_credited_once` | yes |
| `s8_fund_goal_moves_money_once` | yes |
| `s8_double_tap_app_sends_once` | yes |
| `s8_double_tap_exactly_one_transfer` | yes |
| `s8_timeout_submit_is_indeterminate` | yes |
| `s8_timeout_tsq_before_any_resend` | yes |
| `s8_timeout_not_found_is_uncertain` | yes |
| `s8_timeout_transfer_booked_once` | yes |

The original reference was retained after the simulated lost response. Recovery
queried that reference without sending another transfer. The wire-level repeat
of the original successful transfer was rejected and did not debit twice.

The private JSON report SHA-256 is `26fc392ea35a084296c54115a46067d4ab522336f6ff3e951a4c8c09c2d0f871`.
The full redacted report and its Markdown rendering are retained privately in
the operator validation directory, alongside the durable sandbox mutation journal.
No credentials, provider identifiers or bank-account details are included here.
The SSH transport later exited 255; the published reports and released journal
were checked independently. The financial requests were not rerun.

This establishes provider behavior, not current-head application/UI acceptance.
The installed staging app and PIN schema still require a controlled rollforward.
Interest-enabled wallet creation is not proof of actual monthly interest accrual
or payout. The provider cannot manually trigger the monthly event; the separate
capture/replay regressions exercise its supplied payload and failure recovery.
