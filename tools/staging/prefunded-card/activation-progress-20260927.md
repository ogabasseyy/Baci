# First-card staging activation progress, 27 September 2026

## Live proof

- Treasury prerequisite R3 installed by owner; independently read back exact
  source wallet `01M238A0V75387H4HZ15YFWGX3`, opening 10,000 kobo, no reservations
  or consumed budget. First restricted-TLS snapshot is recorded.
- Existing migrated goal `430314fd-cd8b-4579-98d4-e9f345713dd6` remains NGN 100.
  No card operations, checkout intents, canonical credit routes or active core
  card logins were present in the post-install read-only check.
- Receipt DB `7686901100561231906` now has the reviewed original-signature
  table/functions. The owner completed R2 and independent readback verified
  the SQL contract, source/mounted artifact hashes, GET 405 and unsigned POST
  401. Existing receipts are not retroactively assigned provider signatures.
- Intake config still points to staging, has a test-only provider secret and a
  32-byte receipt key. Its existing ingest JWT is valid; no secret was printed.
- Fixed prefunded deadline remains `2026-09-29T15:59:10Z`; approval is at most
  10,000 kobo from the separate company wallet, not the customer's savings.

## Source work completed in this turn

- Luna fixed repeated checkout reconciliation updates; the exact regression was
  red before the fix, then the seven-test disposable checkout suite passed.
- Luna capped saved-card capability at goal remainder, free approved budget and
  reserve-adjusted provider snapshot. Reads do not replenish the budget.
- Terra added transactional owner enrollment with whole-history reconciliation,
  scope locks, identical retry and late-failure rollback. Six disposable tests
  pass. It intentionally refuses intervening unmatched inflows rather than
  inventing a catch-up opening. This SQL is **not applied**.
- Parent built the receiver daemon and canonical prefunded replay factory as
  standalone sibling bundles; no cross-worktree runtime imports. Output is at
  `/private/tmp/baci-prefunded-replay-20260927-ready`. They are **not deployed**.
- Parent prepared the original-signature intake owner upgrade, with pinned input
  artifacts, narrow restart, exact SQL/RPC checks and restored-byte rollback.
  Descriptor-relative capture and exclusive publication preserve directory swaps
  and late concurrent file replacements without overwriting either version. See
  `receipt-provenance-owner.md`; this is **not card activation**.
- Receiver signature test mocks now satisfy their generic RPC contract; their
  22 tests, scoped typecheck and scoped Biome pass. No production receiver logic
  was changed by that typing correction.

## Validation boundaries

112 receiver tests and 67 canonical replay/config tests pass. The independent
signature SQL concurrency/restart/lease-expiry suite passes. The owner bundle has
18 focused Python tests including a disposable real SQL catalog check. Canonical
and receiver monorepo typechecks pass all six tasks each (cached where unchanged).
Monorepo lint remains red on existing mobile findings in the canonical tree and
existing web findings in the receiver tree; no unrelated formatting was attempted.
Whole-program financial E2E and phone card readiness are not claimed.

CodeRabbit reviewed the uncommitted prefunded-card directory with no critical/high
findings. Its minor checkout-capability parity finding still needs a bounded
follow-up before the first-card route is enabled; it does not affect this receipt
capture upgrade. The owner installer additionally receives independent Terra
review of the frozen artifact, including its concurrent-file preservation boundary.

## Superseded first owner handoff

Terra approved the frozen no-clobber receipt bundle after the late-leaf race was
reproduced and fixed. All six artifact regressions also pass unprivileged on the
VPS in an isolated scratch directory; this did not touch the running intake.

The first reviewed bundle remains at
`/home/bassey/baci-receipt-provenance-20260927`. Its runner SHA-256 is
`3c77123f9fc82229d6f5b4d1689a3cffc2ccb3703f344baa6123a10745af78f7`;
the checksum-list SHA-256 is
`aaf1d16255df8f439c5aa6eb37caeed7b013c1401330d0b5640b2184709efd2a`.
The owner ran this revision; the schema apply refused because its unconditional
revocations referenced absent `service_role`. Readback found no signature table
or functions and the unchanged original intake, still running without a restart.
The exact original bundle failed the corrected receipt-only scratch fixture with
`role "service_role" does not exist` (psql exit 3). Do not rerun this revision.

Revision 2 makes only that role optional while retaining revocation when it exists,
with tests for broad default privileges. Luna added redacted stage/exit/SQLSTATE
diagnostics. Terra independently approved the SQL/test change and proved omitting
any of the three optional revocations fails its respective regression assertion.
CodeRabbit was attempted for the receiver directory but refused the existing
236-file scope (150-file limit); it did not complete a review of this revision.

## Completed R2 owner handoff

Both SQL role-shape rehearsals and all 23 owner/contract/artifact/package checks
pass (25 focused tests total). Both monorepo typechecks pass 6/6 tasks; existing
lint failures remain in mobile-storefront (canonical) and web (receiver). Terra
also reviewed the safe diagnostics and approved them; the file publisher and fixed
deadline are unchanged.

The owner successfully executed the R2 bundle from
`/home/bassey/baci-receipt-provenance-20260927-r2`. Runner SHA-256:
`4330fd6e72c00c9a9f0cde274c7a890416e9296f6b195b69aa2a2046f63bbe22`.
Checksum-list SHA-256:
`899bd979811e70bcbee174b5b9830f01ef6607b84c69a780466670e902b15de3`.
The completed Mac command was:

```sh
ssh -t -o ServerAliveInterval=15 bassey@82.29.190.219 'bash /home/bassey/baci-receipt-provenance-20260927-r2/owner-command.txt'
```

Observed completion marker: `RECEIPT_SIGNATURE_CAPTURE_READY`; owner audit directory
`/root/baci-receipt-provenance.CKATzxtO`. This upgrades receipt provenance only;
prefunded card payments and replay activation remain disabled. No rerun is needed.

## Restricted runtime preparation

Read-only inspection found both existing replay worker JWTs expired at epoch
`1790424621`. The old replay container is running, but that does not prove useful
receipt processing. Its config has no prefunded adapter. Replacement credentials
must retain the exact worker roles/audiences and expire no later than the approved
deadline; the underlying signing keys must not be installed in the replay worker.

The app database still has three NOLOGIN executor roles with no passwords and
SQL NULL validity deadlines. No credit route or card operation exists; the goal
still shows NGN 100. Initial credential provisioning must handle that natural
NOLOGIN state, not assume an explicit infinity value. A changed source/template
or passing local test is not evidence of a live credential or replay cutover.

Luna's checkout-capability parity correction now rejects any existing Paystack
method, any unfinished checkout intent, and a missing canonical credit route.
The scratch regression and seven-test checkout suite pass; the corrected SQL is
not installed on the live database. Foundation source pins have been refreshed
for the prepared capability, promotion and historical-alias changes; this does
not authorize rerunning the fresh-install foundation on the installed database.

The next owner bundle is now reviewed, tested, uploaded and hash-verified, but
not executed: see `runtime-preparation-owner.md`. It prepares restricted runtime
credentials and proves actual TLS; it does not activate payments or swap replay.

## Remaining ordered gates

### Runtime preparation R2 correction

The owner ran the first runtime bundle: role provisioning committed, but the
restricted readiness check refused. Audit:
`/root/baci-runtime-preparation.wDArxv3w`. Independent read-only inspection now
confirms all three executor roles LOGIN, NOINHERIT and fixed September 29 expiry.
Credentials and prepared configuration must be retained; do not rotate on retry.

The exact executor session query reproduced SQLSTATE 42803 on live PostgreSQL17:
`GROUP BY login.oid` cannot infer selected flags through the `pg_roles` view.
Grouping all selected flags fixes this. A second readiness bug excluded the
authorizer from its own parameterless probe; its allowlist now permits only that
additional `SELECT true`. Corrected identity/session/probe queries passed under
each role in read-only sessions. Real scratch PostgreSQL18 executor regressions
failed before the fix and pass afterward. These are not yet a live TLS/password
readiness result.

R2 bundle uploaded and hash-verified at
`/home/bassey/baci-runtime-preparation-20260927-r2`; the same permanent Mac launcher
now pins R2. See `runtime-preparation-owner.md` for hashes and effects. No root
execution, service start, financial operation or replay cutover performed by this
correction. 32 Python preparation tests, two real PostgreSQL executor tests, 42
Vitest tests and full typecheck pass. Full lint has unrelated mobile failures;
CodeRabbit refused the 153-file scope. Cards and prefunded replay stay disabled.

### Runtime preparation R3: full CLI boundary

R2 owner execution still refused at restricted readiness; audit retained at
`/root/baci-runtime-preparation.3AoPYYvK`. Terra reproduced the remaining cause
locally: the CLI reparsed already-transformed configuration, whose injected
profile fields violate the strict raw-input schema. This fails before DB contact,
despite individual executor socket/TLS tests passing. R3 retains and revalidates
the original bounded private-file source without changing accepted schemas.

The complete compiled CLI `--check` then `--connect` regression uses real scratch
PostgreSQL TLS/SCRAM, synthetic credentials and loopback-only test DNS. It was red
against R2. Fixed safe profile/phase/code diagnostics also survive the owner
wrapper; no raw secrets or driver error messages are emitted. Public read-only
inspection found the VPS database reachable, its certificate hostname/dates valid,
and Node24.18; CA/password verification still requires the owner-only config.

R3 bundle uploaded to `/home/bassey/baci-runtime-preparation-20260927-r3` and the
permanent Mac launcher repinned. See `runtime-preparation-owner.md` for exact
digests. No root run, role rotation, service restart, replay activation or money
movement was performed by the agent. Retain both prior audit directories and
private credential/config files. The approved budget and September29 expiry stay
unchanged. Do not run the unused diagnostic draft or an older prepare bundle.

### R3 owner result confirmed

Owner reported `restricted-runtime-prepared`, `restrictedTlsVerified:true` and
`RESTRICTED_RUNTIME_PREPARED`; audit `/root/baci-runtime-preparation.JeOlVsRk`.
Configuration SHA256:
`cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3`.
No services, replay replacement or card payments were enabled. Fresh read-only
inspection confirms routes/operations/intents all zero, goal NGN100, and treasury
reserved/consumed both zero. Old replay remains unhealthy with expired tokens.
Receipt store has 3 processed and 11 quarantined receipts, and zero original
signature rows; original capture is installed but no fresh signed financial
delivery has yet been observed. Never manufacture those signatures.

### Remaining activation sequence

The combined signed replay/enrollment gate is owner-executed and independently
verified. Audit: `/root/baci-replay-cutover.hIfMnF6G`; marker:
`SIGNED_REPLAY_ENROLLED`. The new replay worker has a completed-pass heartbeat,
old worker is stopped, and the fixed deadline timer is active. Read-only database
results: one credit route, zero card operations/intents, NGN100 goal principal,
zero treasury reservation/consumption. The pass claimed zero receipts: no new
provider settlement or first-card test is proved. Do not rerun preparation or
cutover. `replay-cutover-owner.md` retains the checksums and recovery boundaries.

1. **Complete:** original-signature capture installed and independently verified.
   Old receipts are not retroactively given fabricated signatures.
2. **Complete:** restricted worker configurations and TLS role identities.
   Protected replay runtime and recurring treasury verifier are installed.
   Do not schedule a second recovery runner beside the combined
   background runner.
3. **Complete:** guarded historical alias replacement, canonical enrollment and
   signed receipt replay cutover. Customer opening principal stays 10,000 kobo;
   company prefunding authorization remains a separate 10,000-kobo budget.
4. Deploy authenticated first-card checkout/callback behind the existing staging
   origins and verify it privately before allowing phone traffic. Saved-card
   enablement remains separate.
5. Owner's bounded card test must prove collection, company-wallet transfer,
   genuine original signed receipt, exactly-once ledger projection and the phone
   showing the updated progress. Collection alone is not savings funding.

### Reviewed worker/SQL gate prepared after replay success

The coherent owner bundle was uploaded and hash-verified before execution:
`runtime-workers-owner.md` / `activation-workers.sh`. It installs the separate
restricted snapshot verifier and combined recovery/dispatcher, applies only the
guarded checkout function delta, and proves their initial passes through the real
systemd units before scheduling. Public checkout stays disabled. No credential
rotation, lease extension, production mutation or manual treasury transfer occurs.

Parent caught and fixed the background CLI's raw/transformed configuration mix-up;
the regression is red before the fix and green afterward. Luna's phone failure
was a stale test fixture; its capability/limit/browser-launch coverage now passes
without changing production UI code or enabling saved-card routes. Terra's SQL
delta preserves catalog identity/ACLs and opening principal in real scratch PG
tests. Parent addressed fresh replay-heartbeat and scheduled completion findings.
33 focused Python/SQL/launcher and 29 runtime tests pass, six typecheck tasks pass, and the
full mobile suite passes 1,257 suites / 7,358 tests. The broad web/lint runs have
unrelated failures, recorded in the worker handoff; full monorepo green is not claimed.
The broad run was stopped after those unrelated failures; web did not finish,
and five Turbo tasks completed. Logs are retained; no pass is inferred from
Turborepo's signal-handling exit status.

### Worker/SQL owner execution confirmed

Owner audit `/root/baci-prefunded-workers.8DTV58ja` reports
`PREFUNDED_WORKERS_SCHEDULED`. Independent read-only checks at 19:44 UTC confirm
the real snapshot/background units completed successfully on recurring timers;
all five desired SQL function digests and original OIDs match. Snapshot sequence
5 records 10,000 kobo available at 19:44:18 UTC. Database identity remains
`7685292944002592802`; one credit route, zero operations/intents, NGN100 principal,
and zero company budget reserved/consumed. Both stop timers retain 29 September
15:59:10 UTC. Public card payments remain disabled; no charge or transfer proved.
Do not rerun completed owner installers. Next gate is public first-card checkout
and callback deployment, then authenticated public verification and the bounded
owner phone test. The existing saved-card route remains separately disabled.
