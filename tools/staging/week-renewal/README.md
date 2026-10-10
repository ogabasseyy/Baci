# Lane A preparation, not renewal

Status: **prepared-review-required**. There is no activation implementation.
The preparer creates a root-private candidate/backup directory only. It never
installs files, changes live config, calls SQL/providers, or starts/stops services.
Do not use the historical five-route `renew-seven-day-owner-root.sh`.

## Scope and fixed targets

- Gateway preview: `2026-10-06T15:59:10.442Z` (preserve `.442` contract).
- Draft/funding guards and timers: `2026-10-06T15:59:10.000Z` / epoch `1791302350`.
- The predecessor hashes are fixed in `renewal_contract.py`, including actual
  deadline service/timer disk bytes observed read-only on September 30.
- Gateway code/unit, old startup evidence and both deadline stopper services are
  immutable. All 23 routes, container/network identity and unrelated binding
  fields survive unchanged. Only lease expiry/review/not-before are previewed.
- Funding env changes only the exact unquoted `BACI_SAVINGS_LEASE_EXPIRES_AT`
  line. Unexpected spelling/quotes/duplicates refuse. No credential is renewed.
- B public app, card/test-payment services, workers, replay, snapshots and
  notification workers/timers must remain stopped. Container restart policies
  must be `no`; an ambiguous state or effective-unit drop-in refuses.
- No artifact rebuild, binary edits, SQL, role changes, treasury reset, or
  principal changes. Same 10000-kobo principal/approved treasury, zero reserved
  and consumed, and old `retired_unconfirmed` intent are asserted from inventory.

## Parent review and next owner action

1. Run `for test in tools/staging/week-renewal/*.test.py; do python3 -B "$test" || exit; done`.
2. Review the source and `SHA256SUMS`. The Mac launcher uploads only that pinned
   source closure into a new user-owned 0700 directory; source files become 0400.
3. Run `sh tools/staging/week-renewal/stage-preparation.sh --stage` (no sudo).
   `--verify-stage` verifies a retained upload without overwriting/deleting it.
4. **Only after parent review**, the user runs the one absolute invocation:
   `/bin/sh /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/week-renewal/stage-preparation.sh --prepare`.
   It prints “Preparation only; does not renew or restart staging”, verifies both
   source closures, and opens an interactive owner sudo prompt over SSH.
   `--print-owner-command` prints the same future command without executing it.
   That command verifies the
   staged closure, copies it into a fresh `/root/baci-week-renewal-a.XXXXXXXX`
   0700 directory, verifies the copied closure again, then calls preparation.
5. It reuses `/root/baci-week-renewal-inventory.BPBuOXTq/inventory-result.txt`;
   no second inventory command is needed. Generic stdout contains only status,
   fixed dates, refusal gates, private output path and receipt hash, never config,
   JWTs, provider output, exception text or raw inventory.

API: `renewal_owner.prepare(directory, bundle_sha256)` from a verified root-private
bundle. `directory` must be the executing source directory directly under `/root`.
All live source metadata/hash checks finish before any originals are copied.
Original bytes and metadata receipt are retained in `lane-a-preparation/original`;
candidates in `candidate`, with 0700 directories and 0600 files. A stale
`startup-evidence.json` is backed up only, never emitted as a fresh candidate.
`binding.preview.json` is **not installable startup evidence**; its review time
must be recomputed immediately before a separately reviewed activation.
Partial output is retained as `.pending`; collisions refuse without overwrite
or delete. A new owner invocation uses a new root bundle, not destructive reuse.

## Diagnosing a refused preparation

The original preparer hid the failed check behind a generic redacted refusal.
Do not retry that command blindly. The updated sealed bundle supports:

`/bin/sh /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/week-renewal/stage-preparation.sh --diagnose`

The launcher retains a fresh root-private copy of its pinned source. The
diagnostic itself reuses the exact preparation input/candidate/runtime checks
but creates no lock, candidate or backup files and performs no live mutation.
It reports a whitelisted refusal code, trusted source module/line and, for a
failed file check, its known input path and numeric metadata only. It never
prints file contents, credentials, exception messages or raw tracebacks.
Existing predecessor pins, ownership/mode checks and stopped-runtime rules are
unchanged. A diagnostic pass is not renewal or activation readiness.

The owner diagnostic identified `binding-22-routes`: the preparation check had
incorrectly stopped at the engagement contract, omitting the later manual
contribution RPC. Reconstructing the reviewed 11-route binding through its
16/22/23-route installation sequence reproduces the exact pinned live binding
SHA256 `30b0e1b36b75f2e32348242d1f5808c1e2b58126ff1311540d6384cf1aeb2fb2`
and its 2444-byte size. The corrected check requires all 23 routes, including
`/rest/v1/rpc/allocate_customer_savings_contribution`, and additionally pins
their normalized path/method contract. It does not delete a route, accept an
arbitrary count, or change the predecessor binding hash. A byte-identical
binding regression fails on the original count check and passes on this fix;
the obsolete 22-route shape and same-count path/method expansions still refuse.

## Missing activation gates and rollback boundary

The funding service was active after expiry with its stopper timer inactive.
Preparation deliberately leaves that live state untouched; the future reviewed
activator must stop it before swapping anything, arm/verify the stopper before
any start, and refuse after the fixed deadline. Funding JWTs are expired and are
not rotated here. Unverified numeric replay JWT `exp` claims are redacted metadata,
not signature/audience/role authority and never authorize replay activation.

Fresh firewall/host reachability, exact runtime inventory, startup evidence,
effective unit/stop-target/schedule proofs, installed A artifact/runtime closure,
auth token cryptographic contracts and bounded unauthenticated HTTP probes remain
future gates. Fresh read-only physical DB snapshots must reassert principal,
budget and retired-intent fences. This old inventory is not fresh DB completion.

`public.recognize_piggyvest_staging_inflow` and
`public.resolve_piggyvest_staging_goal_mapping` contain the expired SQL cutoff.
Financial replay stays off. Paid-interest receipt application/allocations and its
worker are absent from the inventory; parent-owned pending accrual work is separate.
Notifications role expiry is also not renewed. No bank-inflow, paid-interest,
notification delivery, provisioning, card checkout or renewal completion claim.

Preparation has no live rollback to perform. A separate reviewed activator must
preflight all backup/collision states before stopping, preserve these originals,
compare exact reviewed old/new trees before each restore, retain failed candidates,
and leave expired original services stopped on failure. Never restore/start old
expired config or roll back a database/provider operation automatically.
