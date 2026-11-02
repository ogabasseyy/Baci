# PiggyVest goal lifecycle: port record for the 39 backed-up migrations

> Decision taken 2026-10-31 (program plan); written, and every statement about main checked, on 2026-11-02.
> Documentation only: nothing here changes the database, the app or any flag. Task: `P7-lifecycle-port-record`. Rule: R3.

## Decision

**Port none of the 39 files verbatim.** Every one of them is tied to the old staging integration, so none can run on
main as written. Keep only the logic worth having, rewritten inside four planned tasks:

| Verdict | Files | Where the logic goes |
| --- | --- | --- |
| Re-port logic | 6 | `P7-goal-terms-consent` (terms and consents) |
| Re-port logic | 4 | `P7-goal-refund-request` (cancel snapshot and recovery read) |
| Re-port logic | 1 | `P7-price-follow-job` (live price source) |
| Re-port logic | 1 | `P7-goal-post-exit-interest` (interest period attribution) |
| Drop | 20 | Not ported. Reasons below |
| Defer | 7 | Device change. Not on the launch path |
| **Total** | **39** | |

"Re-port logic" means a task reads the old file for its rules and writes new code and a new migration under main's
current conventions. It never means copying the file.

## Source and how to re-check it

- **Source:** the local, private backup ref `refs/backups/2026-10-31/cursor-savings-phase1`, commit
  `d5e56bb67a47adf8f6fd8b4a5d836cfd06ce9c6a`. A snapshot of an old worktree; not on GitHub, and it must not be pushed.
- **The 39 files:** every migration under `supabase/migrations/` from `20260912140000` to `20260912185000`
  (inclusive) that the backup commit adds on top of the main commit it branched from. The same range also holds
  `20260912150000_backfill_manual_order_document_dates.sql`, byte-identical on main and not part of this record.
- **Hash:** SHA-256 of each file's bytes as stored in that commit. Where main's old subsystem reports under
  `apps/web/src/lib/piggyvest/*.report.md` quote a frozen hash for one of these files, it is the same value.
- **Compared with:** `origin/main` at `bf5052a3669f5f29cc48295f5e4a1eac4c2b0635` (committed 2026-11-02). 36 of the 39 paths
  do not exist on main. 3 paths exist on main with different content (see "Versions already on main").
- **Re-check one file** in any clone that has the ref:
  `git show "refs/backups/2026-10-31/cursor-savings-phase1:supabase/migrations/<file>" | shasum -a 256`.

## Why none of them can be ported as written

Each file is tied to the staging integration in one of two ways (the "Tie" column below):

- **direct:** the file itself refers to the staging integration registry, the staging wallet and goal mappings or
  provisioning tables, the staging policy writer login, or a check that only lets it run on a local test database.
- **chain:** the file only works on top of objects created earlier in this same chain (the goal-policy bindings and
  scope lock, or schemas built on them), and those require the staging integration registry.

The launch design is different: money-moving work runs under the dedicated PiggyVest primary logins, each wallet
holds one kind of money (the backing state), and a goal has a single exit claim (R3).

The backed-up chain would not even apply on top of main. Main's `20260912140000` is a different, consumer-derived
replay backfill: it has no bindings or consents tables, but it already creates `terms`, `snapshots`,
`lifecycle_terms` and `lifecycle_activations`, and it already defines eight of the backed-up `piggyvest_goal_policy`
functions with the same argument types (see "Goal-policy functions already on main"). The backup's CREATE statements
would therefore fail because those tables and function signatures already exist.

This record supersedes [piggyvest-local-draft-contract-2026-09-19.md](../piggyvest-local-draft-contract-2026-09-19.md)
where it calls the unported purchase and cancel command functions, device change, draft closure and collection
reconciliation "a separate deployment prerequisite". They are dropped or deferred as recorded here, none of them is a
deployment prerequisite, and the reserve-principal purchase is never revived (R3).

## Per-file verdicts

| # | File | SHA-256 | What it does | Tie | Verdict | Target |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `20260912140000_goal_policy_tables.sql` | `63fc591f97a3231c050a4bd96fc13c77b5758c132767377ad29b6d0c6ba5305a` | Versioned terms (version + hash), immutable consent | direct | Re-port logic | P7-goal-terms-consent |
| 2 | `20260912140100_goal_policy_scope.sql` | `dad8166518420742779e0a1bbca93bdaabdf127fc0bfe06bba4afabb18c27e66` | Goal-policy scope lock and unfunded check | direct | Drop | - |
| 3 | `20260912140200_goal_policy_api.sql` | `adddc167467f9282925c381a91cd4a4884cb985349c0c1ce5e2b158399f8d9f4` | Stage, accept and read a goal policy | chain | Re-port logic | P7-goal-terms-consent |
| 4 | `20260912140300_goal_policy_canonical_commands.sql` | `0f9536df0216ebd26a75be9c0ad1b53c8d1f9ddb0eac1d1baff6e42147c0a24c` | Absolute timestamps and normalised ids in policy commands | chain | Re-port logic | P7-goal-terms-consent |
| 5 | `20260912150000_goal_lifecycle_activation.sql` | `7be6c78c9f7bca3d37fe0aa1b28bd55e9c71d112dc3afc46814ac001857a1a16` | Lifecycle activation after consent (price guarantee) | direct | Re-port logic | P7-goal-terms-consent |
| 6 | `20260912150100_goal_lifecycle_duration_consent.sql` | `85d7fc5993bbb7f982dff03f9d09fe4d7216373b4352da9869b69bc12f54cf46` | Explicit duration consent and maturity dates | direct | Re-port logic | P7-goal-terms-consent |
| 7 | `20260912150200_goal_lifecycle_policy_ceremony.sql` | `7f9113553ae543d1c32ecbace53712939328a9e889ceec3d08257100e40230cf` | Generic consent cannot stand in for lifecycle consent | direct | Re-port logic | P7-goal-terms-consent |
| 8 | `20260912160000_cancel_plan_preparation.sql` | `b1b702dc20b46cb2e4f5e9ad18debc42a4dc6d773f9587918f0664497d6a64ad` | Cancel quote and preparation (first version) | chain | Re-port logic | P7-goal-refund-request |
| 9 | `20260912160100_cancel_plan_legacy_isolation.sql` | `470bee8c38a647a1ca09cc41badabafc10bfdd6a3f549e8bee510ccb2b6b4171` | Cancel refused for goals holding legacy money | chain | Re-port logic | P7-goal-refund-request |
| 10 | `20260912160200_cancel_plan_preserve_goal_snapshot.sql` | `9922d854a2bfa7b3706b9a715d6631aa215a3296bc6b4758c225c0d19a750470` | Cancel snapshot without touching the goal row | chain | Re-port logic | P7-goal-refund-request |
| 11 | `20260912161000_cancellation_recovery_read.sql` | `b223093e286b288ae7cfed3b76bcc45bfa79d50557301e99f6dcb1a05b882cdc` | Cancellation recovery read | chain | Re-port logic | P7-goal-refund-request |
| 12 | `20260912162000_purchase_preparation_tables.sql` | `d7a8a3671ff3233da097c0deba8b56ca5ae908a9fed54ded510c9505cde3c0b7` | Purchase preparation tables (quotes, intents) | chain | Drop | - |
| 13 | `20260912162100_purchase_preparation_commands.sql` | `acb035ae118356307753200c4f0dc6a678ce2b278a9778c2a7f98d0db9136da3` | Purchase preparation commands (reserve-principal purchase) | direct | Drop | - |
| 14 | `20260912164000_purchase_pricing_sources.sql` | `f1ee8116a260563fd531500019d05b2ce2f5c41b47d4a5f2f61b7ddea21aec71` | Live device price source | chain | Re-port logic | P7-price-follow-job |
| 15 | `20260912164100_purchase_pricing_publish.sql` | `eac7374fd5e3777315da2ce4928e1d13e13f8569e33f67139090923d88b6e3af` | Purchase quote publication | chain | Drop | - |
| 16 | `20260912164200_purchase_pricing_revalidation.sql` | `e66b0baff7357c39ba87c341ce59551f1fbeb4d979bd4600362c5c09d58ed997` | Purchase quote revalidation | direct | Drop | - |
| 17 | `20260912165000_schedule_proposal_storage.sql` | `e47b30078e23e9f0e5ce42397df16b3aef186c4c0cab2cc21b9cbe084caa56ce` | Contribution schedule proposal storage | direct | Drop | - |
| 18 | `20260912165100_schedule_proposal_commit.sql` | `3149aa40018c69a888e627f80ff5d73680ff83c5c1304e8839076075eddf882f` | Contribution schedule proposal commit | chain | Drop | - |
| 19 | `20260912170000_customer_funding_capability.sql` | `1146d13f3a8187007b9a542f5d9ca3b9256353f18b3886e003795782a5fa4062` | Funding capability read | direct | Drop | - |
| 20 | `20260912171000_purchase_current_recovery.sql` | `f5893cd714494113e66ebff4ed134870228452d08b3238faa5e77e29c4b6555d` | Purchase current-recovery read | direct | Drop | - |
| 21 | `20260912172000_collection_reconciliation.sql` | `f3f29cfa7311498075ac16a207457a057945059d1880b41e18b0a20ac947d40c` | Collection reconciliation correlations | direct | Drop | - |
| 22 | `20260912180000_device_change_versions.sql` | `3b11dbf9a14815c4f916f8b3cf2ce75f4bb30bf32352cf27452b47ace933bc1e` | Device change revisions | chain | Defer | - |
| 23 | `20260912180100_device_change_publication.sql` | `a97500ea39369ba979fe3347ef3f350a597d35f9b8d6ff3988261cfb19eab462` | Device change publication | direct | Defer | - |
| 24 | `20260912180200_device_change_confirmation.sql` | `b49c7d60c1912534a1ad81c69666078079b9e1c0a8b6ce2bdb2d150c0b4e5f12` | Device change confirmation | chain | Defer | - |
| 25 | `20260912180300_device_change_canonical_read.sql` | `fe2afd05709cfd6ef963c2d2cf4144c2fa3a05f5e170592d34e5503b4908a4c8` | Device change canonical read | direct | Defer | - |
| 26 | `20260912180400_device_change_pricing.sql` | `f30293f2b70a239682522ba922f90539a60a21c6e98a2170436871f634c6190d` | Device change pricing | chain | Defer | - |
| 27 | `20260912180500_device_change_operations.sql` | `609179e365704569762f53d0c70d89ddaeecf94b20d2767891f042c1ca9e216a` | Device change operations | direct | Defer | - |
| 28 | `20260912180600_device_change_lifecycle_funding.sql` | `28ccf41a93f6fcbaf0455cf393c4992f349d8cb823cfea8e18b5b99fd9007dfc` | Device change lifecycle and funding | direct | Defer | - |
| 29 | `20260912181000_draft_closure.sql` | `2a0976ab77b7f593452db7268ef1b35522f5fd83455b4c1d0023d24c9f72b113` | Draft closure | direct | Drop | - |
| 30 | `20260912181100_draft_closure_terminal_guards.sql` | `e3ebceb5b6b5beb69bc9a6fb9a844d9aaed6701f029aa6876b2c405349f5d58d` | Draft closure terminal guards | direct | Drop | - |
| 31 | `20260912182000_protected_offer_publications.sql` | `8da9524405f3789d5bed641c6ba0c01eb0113dfb4284f8806ff4ab9498b46570` | Protected offer publications | chain | Drop | - |
| 32 | `20260912182100_protected_offer_publish.sql` | `4166ce5b902e17929352e6934db28beaa59aea37f8b9ef92606a9283c6a1f89e` | Protected offer publish | chain | Drop | - |
| 33 | `20260912182200_protected_offer_pricing.sql` | `0525d780cc2fb604adb164facb10e3eb811308e940c22a338d94cd0edbbccb5b` | Protected offer pricing | chain | Drop | - |
| 34 | `20260912182300_protected_offer_quote_provenance.sql` | `d47cec538bd4813215d3dc2c9accd1be7c5172d223d7e56bada24eed3b98bd49` | Protected offer quote provenance | chain | Drop | - |
| 35 | `20260912182400_protected_offer_catalog.sql` | `ee8f54c67405be717bf68d53f5c5a8927dbca5ff31267740ee5b841c419c0273` | Protected offer catalog read | chain | Drop | - |
| 36 | `20260912182500_protected_offer_schedule.sql` | `58d06c17e91d18ec288e517ef30d43841ca493835c2e514dd0ff3a94e635df5a` | Protected offer schedule read | direct | Drop | - |
| 37 | `20260912183000_payment_leg_recovery.sql` | `3f62ace9a4fd9734ae3295cca3914a0a0a944b1051938b3fed6571555814668d` | Payment-leg recovery | chain | Drop | - |
| 38 | `20260912184000_period_attribution_recovery.sql` | `77968a2684d13b90d0b31d888a7ec928ec7ff31a82194d1ca6fd7823fcb1dab9` | Interest period attribution record | direct | Re-port logic | P7-goal-post-exit-interest |
| 39 | `20260912185000_reconciliation_cases_read.sql` | `5b078d9c73c9911533d7b6cbdec5eadbe7479408cb540bccbc1fdec82e847b15` | Reconciliation cases read | direct | Drop | - |

## What each re-port carries, and what it must not

### P7-goal-terms-consent (files 1, 3, 4, 5, 6, 7)

Carry these rules:

- Terms are identified by a version plus a hash of their text. A version cannot be accepted until it has been
  reviewed and switched on.
- An acceptance is append-only, belongs to the customer who owns the goal, and records the exact terms version it
  accepted. Sending the same acceptance again changes nothing; a different one for the same version is refused.
- The database clock stamps the acceptance. No consent is ever inferred from old goal data or old timestamps.
- Timestamps in a command must carry a time zone, and ids are normalised before they are compared (file 4).
- No PiggyVest goal account without a current acceptance (file 5, the "consent before activation" rule only).
- Accepting one document never counts as accepting another: a v1 acceptance never satisfies v2 (file 7).
- If the v2 terms include a duration, the customer chooses it explicitly, it is never defaulted and never silently
  extended, and dates use Africa/Lagos (file 6).

Do not carry: the staging bindings and scope lock, the price-guarantee field and the minimum-deposit activation
threshold (price-follow replaces the guarantee), or the "collection paused" activation receipt. Main's
`activate_lifecycle` still holds the guarantee and that receipt; the new code does not call it (rule 7).

### P7-goal-refund-request (files 8, 9, 10, 11)

File 10 holds the final version of the cancel preparation. Files 8 and 9 hold its earlier versions plus the quote and
the legacy-money check it calls, so read all three together. Carry these rules:

- When the cancel claim is won, store a snapshot of what the customer is shown: terms version and hash, principal,
  paid interest and pending interest. Store it keyed by the exit claim, without updating the goal row.
- The snapshot's amounts come only from the confirmed balance. A contribution that is reserved or still in flight
  will settle, so while one exists the final amount is reported as pending and never guessed (R3 fixes the exit
  amount only after in-flight contributions settle).
- A reversed deposit never settles: main's ledger snapshot keeps its reversal flag set and has no review clearance.
  So a goal with a reversed deposit is refused before the exit claim is taken, and goes to reconciliation. File 10
  did the same: it refused before writing anything. Because a won cancel claim never returns (R3), a cancel claim is
  never taken for a goal that cannot reach a final amount.
- A cancel refuses, before the exit claim is taken, any goal that holds legacy (old Paystack) money: a contribution
  that did not come through PiggyVest, an initial contribution, or a saved amount that PiggyVest-confirmed credits do
  not explain (file 9's rule). The re-port carries this check itself. Nothing else enforces it: the planned legacy
  fences stop old paths from touching PiggyVest goals, which is the other direction, and goal-wallet enrolment on main
  does not look for legacy money. Legacy money reaches PiggyVest only through `P8-legacy-goal-move`.
- The recovery read (file 11) is for the goal's owner only, returns the original snapshot, and reports "needs
  reconciliation" on any mismatch. "Not found" never means "safe to retry".

Do not carry: the cancel intent table, the principal reservation, the reviewed-policy mapping table or the old fixed
consent version. The exit claim from `P7-goal-exit-claim` is the only way a goal leaves `active` (R3).

### P7-price-follow-job (file 14)

Carry: read the live price from the merchant's own active product; require the exact variant when the product has
variants (inventory anchors excluded) and take the variant's price override, falling back to the product price; stop
unless the merchant's currency is NGN and its VAT status is known. Also stop, leaving the goal's target and status
unchanged, unless that live price in kobo is a whole number from 1 to 9007199254740991. The shared variant model
accepts a ₦0 override, and a ₦0 price must never mark a goal ready to buy. This restates file 15's price check, so
price-follow needs neither file 15 nor `applicablePriceKobo`.

Do not carry: the pickup shipping rate, the per-goal fee and tax capability table, the protected seven-day price
lookup or the publications table. The job only moves the goal target; it never writes a quote or reserves money.

### P7-goal-post-exit-interest (file 38)

Carry: each interest credit gets at most one append-only attribution record, keyed by the credit it explains and
recording its evidence. The record itself never decides who is entitled to the money.

Do not carry: the old ledger lookups for reservations and settlements. In the launch design, whether a payout counts
as post-exit interest comes from the exit claim's state and watch window, once per PiggyVest transaction id (R5).

## Dropped (20 files)

| Files | Subsystem | Why it is dropped |
| --- | --- | --- |
| 2 | Goal-policy scope | Locks through the staging registry. New code scopes by the goal row lock, the owning customer and the primary logins |
| 12, 13, 16, 20 | Purchase preparation | The reserve-principal purchase. R3: never revived. Goal purchases use the purchase claim in `P7-goal-tender-hold` |
| 15 | Pricing publish | Publishes quotes for that purchase. Price-follow only moves the target |
| 17, 18 | Schedule | Recurring-debit proposals with no transport. Not in v1: goals are funded by transfer or bank deposit |
| 19 | Funding capability | Built on staging provisioning records. Primary-wallet provisioning and the backing state decide funding. Main's copy of the read is listed under "Goal-policy functions already on main" |
| 21, 39 | Collection reconciliation and its case list | Metadata over staging mappings. The plan uses the R1 balance check and deposit reconciliation |
| 29, 30 | Draft closure | A separate terminal path through staging tables. Every terminal path for a goal goes through the exit claim |
| 31 to 36 | Protected offer | A seven-day price promise. Replaced by price-follow consent |
| 37 | Payment-leg recovery | Recovery for the dropped purchase's payment legs. The planned Phase 5 transfer engine records leg outcomes |

## Deferred (7 files): device change

Files 22 to 28 are not ported for launch. They also redefine functions from other subsystems (for example the price
source and publish in file 26, the cancel preparation and schedule in file 27, activation and funding capability in
file 28), so they cannot be taken on their own. Any later device-change design is written fresh against the exit
claim and price-follow; these files are reference only.

## Versions already on main

Four of the 39 version numbers already exist on main.

- Three are the same paths with different content (table below). Main's files are replay backfills added in #3620
  so the migration history replays on a clean database. They stay exactly as they are (migrations are append-only),
  and no re-port may edit them.
- The fourth, `20260912150000` (file 5), belongs on main to `20260912150000_backfill_manual_order_document_dates.sql`,
  which is byte-identical to the backup's copy. The two files already shared that version inside the backup. No port
  may reuse file 5's version: CI's migration version check refuses a duplicate.

| Version | Backup SHA-256 | Main SHA-256 | Main's version |
| --- | --- | --- | --- |
| `20260912140000_goal_policy_tables.sql` | `63fc591f97a3231c050a4bd96fc13c77b5758c132767377ad29b6d0c6ba5305a` | `0e09901da7a0b6fbf0ce1e221948f934a91354dc3626f4999790c1dd8a157ef3` | Consumer-derived goal-policy tables and functions (staging-era) |
| `20260912160000_cancel_plan_preparation.sql` | `b1b702dc20b46cb2e4f5e9ad18debc42a4dc6d773f9587918f0664497d6a64ad` | `79a25e5b22dfa635d45aad0fe143d92bcd08f4010a7da734ac3814fba22219b6` | Cancel intents table only |
| `20260912162000_purchase_preparation_tables.sql` | `d7a8a3671ff3233da097c0deba8b56ca5ae908a9fed54ded510c9505cde3c0b7` | `bf6d2204e53364b862c19dfc45d05b99078161b408ade9086528286abe81fc77` | Purchase intents and quotes tables only |

## Goal-policy functions already on main

Main's `20260912140000` backfill defines these functions with the same argument types as the backup. They are not
ports of the backup, but they carry staging-era logic: every one except the `lock_scope` helper refuses any login
but the staging policy writer, `stage` and `accept` check the staging integration registry, and two hold logic this
record drops.

| Function on main | Same arguments as backup file | Differences and staging ties | Called on main by |
| --- | --- | --- | --- |
| `lock_scope` | 2 | An advisory lock that returns nothing (the backup locks through the staging registry and returns the goal row) | Main's own goal-policy functions; `bind_canonical` (`20260913130000`) |
| `stage` | 3, 4 | Staging registry check | `goal-policy-store-statements.ts` |
| `accept` | 3, 7 | Staging registry check | `goal-policy-store-statements.ts` |
| `read` | 3, 4, 7, 25 | Staging login only | `goal-policy-store-statements.ts`; `bind_canonical` |
| `prepare_lifecycle_terms` | 6 | Parameter named `p_duration_months` (backup: `p_months`) | `goal-lifecycle-statements.ts` |
| `accept_lifecycle_terms` | 6, 7 | Parameter named `p_duration_months` (backup: `p_months`) | `goal-lifecycle-statements.ts` |
| `activate_lifecycle` | 5, 6, 28 | Stores the price guarantee and returns it with a "collection paused" receipt | `goal-lifecycle-statements.ts` |
| `read_funding_capability` | 19, 28 | Reads the staging wallet and goal mappings | `customer-funding-capability-statements.ts` |

These functions stay defined, because migrations are append-only. No launch-path code may call them, and no re-port
may replace or extend them (rule 7 below): re-ported logic goes under new names. Their handlers (`goal-policy-store`,
`goal-lifecycle`, `customer-funding-capability`) are reached only through `runtime-composition`, like the modules in
the last table. The optional task `P7-retire-unported-goal-handlers` (below) retires them or records why one stays.

## Rules for every re-port task (R3)

1. Read the old files from the local private ref only. Never push the ref and never copy a file wholesale.
2. Write a new migration with a new timestamp. Never edit an existing migration, including the three
   backfills above.
3. No re-ported code may reserve, move or release goal money, or mark a goal cancelled, spent or closed, outside the
   exit claim. A PiggyVest goal has exactly one exit path: the claim from `P7-goal-exit-claim`.
4. The reserve-principal purchase (file 13, with its reads in files 20 and 37) is never revived, under any name.
5. No reference to the staging registry, staging mappings, the staging policy writer login or a local-database-only
   check. Function privileges follow [function-privileges.md](../agent-guidance/function-privileges.md).
6. The price guarantee and the protected offer are not revived. Price-follow replaces both.
7. Never CREATE OR REPLACE, alter or extend an existing `piggyvest_goal_policy.*` function. With the same argument
   names it succeeds and silently swaps the body that main's draft chain uses. A renamed input parameter or a new
   return type is refused (SQLSTATE 42P13, checked on PostgreSQL 18), and one failing migration blocks every deploy.
   Use new function names.

## Code on main that calls functions that were never ported

Statement modules under `apps/web/src/lib/piggyvest/` (merged in #3620), one database function and several local
test tools call 25 functions in 10 schemas that are not defined by any migration on main. The statements' SQL text
sits in the shared statement catalog (`postgres-statements.ts`), restricted to staging logins, and the staging
funding route loads that catalog through its wallet-mapping reader. No app route reaches the handlers that would run
these statements: they are wired only in `runtime-composition`, which only tests, fixtures and a package smoke script
import. Re-port tasks add new functions under new names and do not bring these 25 back. This table and the notes under
it are the input for `P7-retire-unported-goal-handlers`, an optional task: all of this code is already unmounted and
nothing on the launch path waits for it. If it is never done, this section stays the inventory.

| Schema | Functions with no definition on main | Calling module | Verdict |
| --- | --- | --- | --- |
| `piggyvest_cancel_plan` | `prepare`, `quote` / `read_recovery` | `cancel-plan-statements.ts` / `cancellation-recovery-statements.ts` | Re-port logic (new code) |
| `piggyvest_period_recovery` | `read`, `record` | `period-recovery-statements.ts` | Re-port logic (new code) |
| `piggyvest_purchase_preparation` | `prepare`, `quote`, `status` | `purchase-preparation-statements.ts` | Drop |
| `piggyvest_purchase_preparation` | `read_current_recovery` | `purchase-current-recovery-statements.ts` | Drop |
| `piggyvest_purchase_preparation` | `observe_payment_leg_recovery`, `read_payment_leg_recovery` | `payment-leg-recovery-statements.ts` | Drop |
| `piggyvest_purchase_pricing` | `publish` | `purchase-pricing-statements.ts` | Drop |
| `piggyvest_schedule` | `read`, `write` | `schedule-store-statements.ts` | Drop |
| `piggyvest_collection_reconciliation` | `observe`, `read` | `collection-reconciliation-statements.ts` | Drop |
| `piggyvest_reconciliation_cases` | `list`, `read` | `reconciliation-cases-statements.ts` | Drop |
| `piggyvest_draft_closure` | `close`, `read` | `draft-closure-statements.ts` | Drop |
| `piggyvest_protected_offer` | `publish`, `read` | `protected-offer-statements.ts` | Drop |
| `piggyvest_device_change` | `confirm`, `publish`, `read` | `device-change-statements.ts` | Defer |

**Database caller.** `savings_draft_private.bind_canonical` (migration `20260913130000`, line 62) also calls
`piggyvest_draft_closure.read`. Main reaches it through `draft-canonical-binding-statements.ts` (loaded only by
`draft-canonical-binding-store.ts`, which only tests import) and the SQL suites
`supabase/migrations/tests/customer_savings_canonical_binding*.sql`. A database function is only checked when it runs,
so `bind_canonical` replays cleanly but fails every call with "function does not exist". It is limited to local test
settings, so it is not a production money path. The retire task retires or rewires the binding statement together
with the draft-closure module; the migration itself stays.

**Local test tools** that need the dropped subsystems, to retire or rewrite together with the statement modules:

- `tools/test/piggyvest-full-schema-check.sql` requires `piggyvest_purchase_preparation.read_current_recovery`
  (file 20) and `piggyvest_collection_reconciliation.read` (file 21). It is the mandatory SQL check of
  `tools/test/hosted-savings-bootstrap.ts`, so that bootstrap fails until both assertions are removed.
- `tools/test/piggyvest-public-compat-cases.sql` (run by `piggyvest-public-compat-local.sh`, planned by
  `piggyvest-public-compat-plan.mjs`) and `tools/test/savings-exit-execution-fixture.sql` (run by
  `savings-exit-execution-local.sh`) write `piggyvest_cancel_plan.reviewed_policies`, a table no migration on main
  creates, and call `piggyvest_cancel_plan.prepare` (the compat cases also call `quote`).
- `tools/test/piggyvest-full-local-plan.mjs` selects registry rows for every dropped subsystem by file name.

The retire task's check for references to dropped functions must cover `tools/test/` and `supabase/migrations/tests/`
as well as `apps/web`.

## Out of scope

The same backup ref holds 10 other migrations that are not on main by name: staging inbox and mapping files at other
version numbers, savings engagement storage, interest accrual and interest policy files, and a UBA Redvault checkout
pilot. They are not goal-lifecycle files and this record makes no decision about them.
