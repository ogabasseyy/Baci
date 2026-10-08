# Replay restoration readiness — 4 October 2026

## Complete paired replay started and independently verified

The separate guarded package at `/root/baci-replay-start.RHDoTCZG` passed actual
candidate read-only readiness, full current-state guards, authenticated runner
evidence and the prestart validator before starting the complete generation.
Independent postflight confirmed its running identity and recent heartbeat.

- Source release: `024b432dd836b0221f3eb1804a228489bdff8353da7e93b54645e3f685c2e1e2`.
- Bootstrap: `a2cb9908376d269f107d7d7be5c34fde52a8171ae071d43c1b9f95e78bc0e91d`.
- Startup owner: `6b7b269fb1ab4014915e159c183e8a4a5ff2406bd8e40ec5f65f51de505d6171`.
- Actual startup audit:
  `/root/baci-replay-start.RHDoTCZG/replay-start-result-1dbf1569564e436a9aa7019fe185cb5c.json`.
- Audit SHA256: `fbd8621fafb418cf44b56c602e70730a3fef8f92ab88c07d8055c3876378f72b`.
- Running container: `9c2bee4e31143df3c1b99045db97ad0f2fcd8b4ff701cfc797e0471e5d62726c`.
- Generation seal: `69585e50cb88aeac5e0660ed235b39f6ac6d675b35cf9acabd32cd2945d695ba`.

The native predecessor was renamed aside, not deleted or restarted. It, the
interest-only predecessor, the retired replay and the failed financial background
worker remain stopped, PID zero and restart disabled. The original fixed
deadline remains 6 October 2026 at 15:59:10 UTC.

Independent full application snapshots remained unchanged after startup. Both
plans retain ₦100 principal; treasury consumed remains 10000 kobo and reserved
remains zero. Receipt totals remain four processed and thirteen quarantined,
with no pending or processing receipt. No quarantine/backoff reset, new payment,
transfer, fabricated interest credit or deadline extension occurred. The worker
being live is not proof that a provider interest payout was received or credited.

Phone-origin wallet, goals, drafts and notifications routes return the expected
unauthenticated 401. Public HTTP and the notifications timer remain active.
Fresh authenticated customer readback through the phone origin returned 200 for
the inbox, preserving nine notifications, and 200 for checkout capability. New
card payments correctly remain disabled with maximum amount zero: the approved
₦100 prefunding budget is already consumed. No additional budget is authorized.

The actual focused runner passed 111 tests across eleven files against all 47
exact captured production sources. Three current source files differed from the
staged build; a separate source-preserving harness restored only its authenticated
captured bytes before this successful run. The original worktrees were untouched.
Runner evidence SHA256: `a7bf2464f576dcfc48def4bf966a1e9685795a025b7f8e408a6275861515353b`;
full report SHA256: `dd763b8e8d9cd6c874e3c0557c983a726171110f81e5d2bb3f5352dc6fa8ecf2`.
All 57 new startup owner, inventory, readiness and bootstrap regression tests pass.
Independent cross-review covered the exact final owner and bootstrap hashes.

Repository lint and typecheck still fail on unrelated mobile-storefront files.
Physical-device push and genuine provider interest delivery remain separate
acceptance gates, not claimed by the replay activation. Sections below record
earlier stages and their then-current state.

## Authenticated generation probes passed

The independently reviewed, probe-only package at
`/root/baci-generation-probes.LlLovPq2` passed its actual preflight and HTTP batch.
Both predecessor credentials returned HTTP 403 / SQLSTATE 42501. The new
generation credential returned HTTP 400 / SQLSTATE 22023 for deliberately null
claim bounds, proving that the generation gate accepted it without claiming a
receipt. All three credentials independently verified the physical receipt DB.
Complete application and receipt snapshots were unchanged before and after.

- Release SHA256: `dc6c195bf058fcfd486b53be87f6d0d74fd033f3ce280adb307127584cca19f9`.
- Bootstrap SHA256: `3e2c9c8ca99037f0888ae5c216a4fa27d5397e69cb9cd4ba1afbd96a818d4a5d`.
- Owner SHA256: `c3ae847d48b4c54fda3716cad9e3b05d239c9a1d46baa621af12c6bbe970747a`.
- Actual probe audit:
  `/root/baci-generation-probes.LlLovPq2/generation-probe-result-9431348e28964275beb38e95f13f1791.json`.
- Audit SHA256: `3b9b84840d92f9b5cd239ac544ca15bd0e00f213d3d4aa556744caf991a1b6b4`.

The isolated probe container and its private temporary credentials were removed
by the reviewed transport. Replay remains stopped; no valid claim, payment,
transfer, interest credit, SQL mutation or deadline extension was attempted.
The focused owner, bootstrap, transport, Context and JavaScript checks passed
58 tests. Remaining gates are candidate readiness and guarded startup; this
probe package grants no launch authority.

## Generation fence committed and independently verified

The separate sealed package at `/root/baci-replay-fence-commit.MTc1AqYx`
passed its actual read-only preflight and submitted the exact reviewed commit once.
PostgreSQL acknowledged `COMMIT`; independent receipt snapshots verified the
reviewed routine change while metadata, receipts, signatures, quarantine and
unrelated routines remained unchanged. Complete current application snapshots
matched exactly except `capturedAt`.

- Source release: `28a618688e57ba5face9d93159eae1b41ddc3f89c4855b7efd58dbd66be27271`.
- Bootstrap: `f0ed9f1613e98840b88fa7109b97126782f586277f2be546a2610dc05afb460d`.
- Owner: `5cedeeca2804adc6515b589315a8b0b45441c5e6c8f54b6f4bc9b4c6bcad9be1`.
- Private audit:
  `/root/baci-replay-fence-commit.MTc1AqYx/fence-commit-result-6a22efcd1f1d460f81a8a5b03c6f89d4.json`.
- Audit SHA256: `2b960715c86bdad3b5bf708a21d8bfdb54dca7a67235bc6a77ca5db53c280928`.
- Committed receipt SHA256:
  `c87f7c6f8c54f7e63220de4f43bf6604fbe36b90a11bba52fc50985584190f4a`.
- Actual fenced body SHA256:
  `560ca6e2881f5c6b1b51ef554a7c2abb9dcc1c5fb74f70a32b528fb1144819e3`.

The durable `fence-commit-submission.json` marker must not be deleted or reused.
Independent postflight readback confirmed both plans still have ₦100 principal,
treasury consumed 10000 kobo and reserved zero. All four replay/background
containers remain stopped, PID zero, with restart disabled. Public customer HTTP
and the notifications timer remain active. No payment, transfer, interest credit,
predecessor restart or deadline extension occurred.

The final focused run passed **134 tests**, including the real-runner boundaries,
commit transport, unknown-acknowledgement protection, source closure, current-state
preservation and stop-only runtime control. Independent agents reviewed the exact
owner/bootstrap hashes above. New source and test files remain below 300 lines.
Repository-wide quality gates still have the previously reported unrelated
mobile-storefront failures; this is not a clean production release claim.

Remaining separate gates after this historical commit: candidate readiness and
guarded complete-generation startup. Device push remains unverified.
The historical sections below record the earlier unfenced state, not current state.

## Real rollback rehearsal completed

The separately reviewed root runner at
`/root/baci-replay-rehearsal-r3.85HQ4psI` passed its read-only preflight and then
submitted the exact rollback-only transaction once. PostgreSQL acknowledged
`ROLLBACK`; independent receipt snapshots verified the original routine,
receipt/signature/quarantine state and unrelated routines were restored unchanged.
Complete current application snapshots matched exactly except `capturedAt`.

- Source release: `9092604e5b9b09a4e0243dd5c6ede57b9591d501c11cf8de8239c4e1787e314a`.
- Bootstrap: `a9e92a1d9bb885e7aa4cc433b49d2f6ac2a5de8462bdf97cefd2d80d33f39fb2`.
- Private result:
  `/root/baci-replay-rehearsal-r3.85HQ4psI/rehearsal-result-631a248b83894c95a579e2f229188999.json`.
- Result SHA256: `2220425c4f261719bedc49355974eeae36b150071f404bca9c722be153d74a7b`.
- Rehearsal receipt SHA256:
  `c1c6376733c80550543184b91d32ac2aab8428091302be6bdd1c8ba28a282faa`.

The submission marker is durable and exclusive; this package must not resubmit.
Full private evidence was independently hash-read and compared after execution.
A fresh scoped database read confirmed both existing and new plans still have
₦100 principal. Treasury consumption is 10000 kobo and reservations remain zero.
Public HTTP and the notifications timer remain active. All four replay/background
containers, including the older legacy replay, remain stopped with restart disabled.

The first read-only preparations refused safely on actual `/run/lock` sticky-mode
metadata and multiple systemd `ExecStart` rows. Both compatibility fixes have
exact regressions and independent review. A retained legacy replay container's
`unless-stopped` policy was separately narrowed to `no` under the exclusive lock;
its state, mounts, image and configuration were verified unchanged. No container
was deleted or started. No charge, transfer, financial worker or interest credit ran.

The final focused run passed **89 tests** across the sealed runner, transport,
inventory, pure rehearsal and database/quiescence guards. All new source/test files
remain at most 300 lines. Repository-wide validation still has the separately
reported unrelated mobile-storefront failures; this is not a clean release claim.

The fence is **still not installed** and live replay **has not started**. Remaining
steps are separately sealed fence application, authenticated nonclaiming generation
probes and reviewed complete-generation startup. Earlier preparation-only notes
below describe the predecessor state, not the completed rehearsal above.

## Verified on the VPS

- The complete candidate exists at
  `/opt/baci-prefunded-replay-generations/complete-9r5r9u8z`.
  Its sealed generation SHA256 is
  `69585e50cb88aeac5e0660ed235b39f6ac6d675b35cf9acabd32cd2945d695ba`.
- The authenticated native-owner release
  `768ce2a340aa9f50802c453f3c85f92020e5df835795df0caecf0be888137df7`
  verified the candidate tree and ran `DockerRuntime.check` successfully.
  This ran only the compiled daemon's `--check` path, with its existing
  isolation and effective deadline checks. The temporary check container was
  removed; no live claimant or financial worker was started.
- The native and candidate receipt JWT signatures were independently verified
  against the pinned receipt PostgREST configuration. Audience, worker role and
  expiry were verified. The candidate also has the exact reviewed generation
  `1a420a7b-0c17-4312-84dc-d276a32f19f4`. No credential was printed or minted.
- Receipt database physical identity is `7686901100561231906`. An independent
  read-only transaction found zero processing receipts, four processed receipts
  and thirteen quarantined receipts. No pending receipt was present in that
  observation. Quarantine was not cleared and retry state was not reset.
- The current claim routine body remains the original
  `3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc`.
  The generation fence is **not yet installed**. A successful readiness check
  or JWT signature verification does not prove server enforcement of generation.

## Important path distinction

The legacy `/opt/baci-prefunded-replay/config/config.json` hash is
`968499d8e16c83d7e9cd28c5d35cd380bf8d5dff72445ceda3bb2ab79ad8f980`.
It is not the retained native generation used by the complete candidate.
The retained native configuration at `native-m_xv_71j` matches the reviewed
`1c1d10c49532ea2a4ee1efa17af24a43619f21d382efa7978562f2e727d9264d`
pin. Do not change predecessor pins to the legacy-root hash.

## Remaining activation gates

The latest focused parent run passed 52 tests: rehearsal 11, replay quiescence
11, receipt database adapter 17 and unchanged financial quiescence 13. The later
repo-wide validation retry entered automatic dependency installation rather than
the requested lint task. Its owned process tree was stopped; unrelated processes
and existing files were not cleaned up. That retry did not produce final lint or
typecheck results and is not a clean quality-gate claim.

The subsequent root preparation authenticated the exact original routine
definition and privately rendered rollback-only SQL at
`/root/baci-replay-fence-prepared.z1q25lo7/rehearsal.sql`, SHA256
`315028b8f028f3537dcf2226123a495238f2f85eb6a88855275c25f05078c69d`.
It was not submitted to PostgreSQL. A new complete protected application baseline
was captured through the authenticated read-only SQL at
`/root/baci-replay-fence-baseline.v0xas66f/application-snapshot.json`, SHA256
`5db33c8e1458958583270d784b1093ae49be30620003e88ea3e70e2c3c7609c5`.
The existing completed-payment audit pin was verified again without rerunning
the payment. The application container uses `/usr/bin/psql`; the receipt
container uses `/usr/local/bin/psql`. The first incorrect client-path attempt
refused before any database apply, then the corrected read-only capture passed.

The new source-only `replay_fence_rehearsal.py` is independently reviewed at
SHA256 `3f3ac5db66820c9fa4ee5e2382f717d92b2082920beb2ca93f3e3148d0405227`.
Its eleven regressions pass. Parent-authenticated callbacks must supply genuine
source/audit reads, complete claimant inventory, current protected snapshots and
the exact rollback-only transport. It admits one submission, never retries an
unknown acknowledgement, and grants no live-start authority. This is not a root
installer or proof that the real rehearsal has run. All current evidence must be
recaptured within the bounded freshness window before actual execution.

The new source-only `replay_quiescence.py` validates the three fixed halted
claimants and receipt-database drain evidence without shutting down public HTTP
or notifications. It does not collect or authenticate evidence, discover unknown
claimants, prove isolation, install SQL or authorize a start. The failed background
container must remain exit 1; its separate systemd unit may have the exact
post-reboot inactive/dead/success/0 state without fabricating a unit failure.
The original all-financial-writers guard remains unchanged.

Local validation passed eleven replay-quiescence tests, thirteen unchanged
financial-quiescence tests and nine cutover-runtime tests. Repo-wide lint and
typecheck still fail on the existing mobile checkout-test issues; this is not
a claim of a clean production release. No activation package was deployed from
this new source-only validator.

1. Review replay-specific quiescence independently of the older all-financial-
   writers shutdown guard. Keep the restored app and notification timer usable;
   do not weaken or reuse the old financial-pass guard.
2. Capture complete current receipt/signature/quarantine fingerprints, routine
   metadata, transaction drain and protected financial snapshots under the
   exclusive activation lock. Readiness alone is not an activation attestation.
3. Bind the existing completed-payment proof without rerunning its financial
   worker. Rehearse the exact reviewed claim-fence SQL with rollback and verify
   unchanged state before separately applying the fence.
4. Prove old-token refusal and new-generation invalid-bounds rejection through
   authenticated nonclaiming server probes, preserving snapshots.
5. Recheck candidate readiness, effective deadline, exclusive launch authority
   and eligible backlog before a separately sealed start. Retain predecessors
   stopped after failure; do not restore unfenced SQL or old-generation replay.

The deadline stays **6 October 2026, 15:59:10 UTC**. The approved treasury budget
is already consumed. No new charge, transfer, refill, claim reset or replay of
the completed payment is authorized by this readiness work. Genuine provider
interest delivery is not required to pass the supplied-payload contract tests.
