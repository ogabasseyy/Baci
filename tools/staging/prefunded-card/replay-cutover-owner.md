# Reviewed signed-replay and legacy enrollment cutover

Owner-executed and independently verified on 27 September 2026. Audit directory:
`/root/baci-replay-cutover.hIfMnF6G`. **Do not rerun this completed cutover.**
Card payments remain disabled; this is receipt replay and enrollment only.

The new replay container is running with a fresh completed-pass heartbeat, its
readiness container exited zero, and the old replay container exited cleanly.
The deadline timer is active for 29 September, 15:59:10 UTC. A read-only database
check confirmed system `7685292944002592802`, one canonical credit route, zero
card operations/intents, goal balance NGN100 and treasury reserved/consumed zero.
The observed replay pass claimed zero receipts, so this is not a new financial
delivery or completed first-card test.

## Completed Mac command (audit reference only)

```sh
/bin/sh /Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/activation-replay-cutover.sh
```

The permanent launcher embeds the literal reviewed bootstrap checksum and opens
SSH for the owner's sudo password. It does not execute a mutable remote command
file to discover its trust pin. Bundle:
`/home/bassey/baci-replay-cutover-20260927`.

- Runner: `e692f5c16a307ba7c0bc991c12e1c3a2cd552933ddac66bfb0da7d2b4ee30189`
- Checksum list: `185094a101e26036dd6b6bccf30640124e10e824a0133a22771b2bf25ae7b740`
- Daemon: `e880009ae5df7a8827d574a29eaa703a55f9f57c801659e47baa29fd6c130041`
- Replay factory: `de2959f583189688a1bb8cf02153325ef314e68c6dded71d7bbce3c832057500`

## Effects and boundaries

1. Verify the sealed owner bundle, exact prepared activation digest, both physical
   database identities and the original replay container identity.
2. Install root-owned code and scoped replay-only credentials under
   `/opt/baci-prefunded-replay`. No Paystack credentials enter this replay runtime.
   Run the actual candidate as UID/GID 65532 with read-only mounts, dropped
   capabilities, no published ports and no restart policy. Existing staging
   database/receipt networks are retained; the existing intake-ingress network
   supplies outbound access for future provider evidence reads.
3. Run `--check` without claims or writes: protected files, matching bundle/config
   digests, restricted TLS executors and both authenticated PostgREST identity
   RPCs. Rehearse the exact SQL transaction ending in rollback, without retaining
   the function replacement or enrollment.
4. Install/start a deadline timer for **29 September 2026, 15:59:10 UTC**, stop the
   old expired-token replay worker, and atomically replace only the pinned legacy
   alias function and enroll the one reconciled goal. Unknown baselines or new
   intervening history refuse. Existing function owner/OID/grants remain intact.
5. Start `pvb-staging-replay-prefunded`; report success only after a fresh
   completed-pass heartbeat, confirmed legacy stop and active deadline timer.

Expected marker: `SIGNED_REPLAY_ENROLLED`. The migrated customer's NGN100 and
company's 10,000-kobo approval remain unchanged. No card collection, transfer,
public checkout enablement, recurring treasury verifier, dispatcher or production
change is part of this command. Future authentic signed receipts can be processed;
the command does not manufacture signatures for historical receipts.

## Refusal and recovery

Files/containers are never deleted to force a retry. Unknown or partial network
state is retained for review. Before enrollment, failed checks leave the old
worker untouched. After the stop/commit boundary, failures report the current
attempt's stage and commit certainty; keep the old worker stopped. An unknown
commit must be reconciled first. A confirmed commit requires forward recovery,
never deleting the immutable route or restarting legacy replay as rollback.
An already running candidate refuses a repeated installer run rather than
stopping it or overwriting its files. Root audit files are retained.

## Verification

- 36 owner/config/package/SQL-renderer tests and 10 enrollment-candidate tests
  pass. Tests cover real scratch PostgreSQL baseline replacement, rollback,
  unchanged principal and ACL/OID, immutable enrollment, exact retry, forged
  artifacts, umask-sensitive permissions, bounded/redacted diagnostics and
  missing/stale heartbeat refusal.
- 77 receiver tests pass; scoped Biome and worker typecheck pass. Both worktrees'
  full typechecks pass six tasks. All 68 recorded artifact source inputs match
  their reviewed digests. Compiled `--check` refuses missing protected config;
  unknown CLI arguments fail without entering the daemon.
- Full lint is not green: canonical mobile findings and existing receiver-tree
  formatting/lint findings remain outside this change. The full canonical test
  run has one failing mobile test in
  `WalletSavingsProgressModal.plan-funding.test.tsx` (1,256 suites passed);
  Turbo interrupts the web run. No full-suite or phone-ready claim is made.
- CodeRabbit refused the 163-file directory scope (150 limit). Luna and Terra
  reviewed the bounded changes; parent reviewed fixes and verified uploaded
  checksums and launcher quoting. Terra's final bounded source review passed.

After successful owner execution: independently verify replay/enrollment, then
finish the independent recurring treasury verifier, bounded dispatcher and
authenticated public first-card checkout. The final card test must still prove
collection, company-wallet transfer, original signed provider receipt,
exactly-once ledger recognition and the phone's updated balance.
