# PiggyVest sandbox contract-proof harness

Proves PiggyVest sandbox behaviour before any money feature relies on it. The
default run is a dry run against a built-in mock: no network, nothing written.
Live runs only ever talk to `https://staging.piggyvest.business`.

## Modes

| Flag | What it does |
| --- | --- |
| (none) / `--dry-run` | Mock sandbox only. Prints evidence marked MOCK DATA. |
| `--live-readonly` | GET requests only against the sandbox. |
| `--live-sandbox-mutations` | Journaled, capped sandbox mutations on allowlisted QA customers. |

A plain re-run never resends a mutation: every one has a journaled slot.
`--new-attempt` opens fresh slots.

## Proof 10 (task S8): sandbox first pass

Proof 10 runs on its OWN scenario (QA customer, main wallet, goal wallet,
funded main, created per attempt) and covers, in order:

1. **Onboard**: the QA customer exists with a main wallet proven to belong to it.
2. **Bank deposit credited once**: a sandbox test-funding deposit into the main
   wallet raises the settled balance by the gross (or the gross minus the fee
   the record shows), never by more.
3. **Create goal**: a goal wallet, distinct from main, owned by the QA customer.
4. **Fund goal from main**: one wallet-to-wallet transfer; main is debited once
   and the goal credited once.
5. **Double tap**: the same action a second time. The app path (same slot, same
   idempotency key) sends nothing; then the SAME reference is sent once more on
   the wire and the run records whether the provider still holds exactly one
   transfer, one record and one debit. Production never relies on provider
   de-duplication; this only records what it does.
6. **Timeout on submit, then status check**: the next transfer is sent, its
   response is dropped (a lost response, which is what a timeout looks like; a
   real timeout cannot be forced on the live sandbox), so the outcome is
   *indeterminate*. The run then checks the status (TSQ) of the same reference
   until it settles or the budget ends. A 404 right after submit is treated as
   uncertain ("not indexed yet" looks the same as "never arrived") and is never
   a reason to resend. If the status stays unknown the transfer is held for
   reconciliation. The step cannot send a second request.

Outflows from main in this proof are capped and budgeted in
`S8_OUTFLOWS_KOBO` (constants.ts); the main-wallet funding floor includes them.

### What the owner must provide for the live run

Nothing in the code changes between the dry run and the live run. The owner
supplies, outside the repository:

| Item | Detail |
| --- | --- |
| `PVB_PROOF_API_KEY` | Sandbox test key (`test_key_...`). Fallback name: `PIGGYVEST_SAVINGS_FUNDING_API_SECRET`. A live key is refused. |
| `PVB_PROOF_BASE_URL` | Optional. Must be exactly `https://staging.piggyvest.business`. |
| Allowlist file | JSON, for example `{"qaCustomerIds": ["qa-s8-first-pass-01"]}`. Each id is 8 to 64 characters of letters, digits, `-` or `_`, chosen by the owner for this run. The harness derives a synthetic identity from it and touches only these customers. It must never name the screen-recording account. |
| Proof 10 wallets | Proof 10 never measures on the shared scenario's wallets. Per attempt it creates its OWN QA customer (key derived from the selected allowlist id, `p10-<hash>-a<attempt>`), with its own main and goal wallets, journaled like every other mutation, so nothing proofs 1 to 9 do can land on the wallets it measures. No extra allowlist entry is needed. |
| `PVB_PROOF_BANK_CODE`, `PVB_PROOF_BANK_ACCOUNT` | Only for a FULL run (proof 4's bank outflow). Not needed for `--proof p10`. |
| `PVB_PROOF_BUSINESS_WALLET_ID` | Only for a FULL run (proofs 3, 7 and 8). Not needed for `--proof p10`. |

### Exact commands

Run from `apps/web`. The condition is needed because the typed client imports
`server-only`.

Dry run (proves the logic against the mock, no credentials):

```
NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
  tools/piggyvest-contract-proofs/cli.ts --proof p10
```

Live sandbox, S8 only:

```
PVB_PROOF_API_KEY=<sandbox test key> \
NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
  tools/piggyvest-contract-proofs/cli.ts --live-sandbox-mutations \
  --allowlist <path to allowlist.json> --proof p10
```

Live sandbox, full run (adds the bank and business-wallet variables above and
drops `--proof p10`). Evidence is written to `docs/piggyvest-contract-evidence`
(override with `--evidence-dir`). Exit code 0 means no proof failed; read the
`s8_*` findings in the evidence for the answers.

### How long a live run waits

Each wait for a money movement has a budget of about two minutes (24 polls, 5s apart;
`LIVE_POLL_INTERVAL_MS` and `LIVE_MAX_POLLS` in constants.ts). The 2026-11-03
live runs showed the sandbox usually settles in under 20s, but once dropped a
test funding entirely and once credited a goal an hour late; a movement that
does not settle in the window is reported as `unknown`, never as a failure.

### Reading the result

Each `s8_*` finding is `yes`, `no`, `unknown` or `not_applicable`.
`s8_timeout_not_found_is_uncertain` is `not_applicable` when the live sandbox
never answered 404 (the mock forces it). A `no` on
`s8_double_tap_exactly_one_transfer` means the provider books a repeated
reference; that is a real finding, not a harness fault.

The live evidence for S8 follows in a separate run; this change only adds and
tests the scenarios.

### How the S8 money verdicts stay conservative

- One ledger of expected movements (`movement-ledger.ts`) is shared by the dedicated scenario's setup funding and every S8 step. A movement is settled only when both its source and destination balance were observed settled. A step that measures a wallet with any unsettled movement publishes `unknown` ("earlier movement on this wallet unsettled"); the raw deltas are still recorded.
- Any verdict-edge case beyond this rule is an accepted limitation. Every non-`yes` verdict and its raw deltas are reviewed by a human before the evidence is signed off, so a false `no` cannot pass unnoticed.
