# Public mutation sidecar handoff — October 2, 2026

Status: local source/tests prepared; parent review and actual staging gates pending.
No public mutation enablement or financial completion is claimed.

## Files and review pins

All changes are new files under this directory in the canonical dirty worktree.
Seven source modules each have a colocated `.test.py`; every source is below
300 lines (largest: `mutation_owner.py`, 275 lines). `README.md` describes the
reviewed request shape, parent entry points and recovery protocol.

These are the exact local SHA256 pins to independently verify before creating
the parent's `reviewedSidecarSha256` map. This list is evidence of file bytes,
not an approval of staging execution.

```json
{
  "mutation_contract.py": "d0693413580675f79f5f5152be5a2525fd844c4bac5cd62e558b62136e1a3979",
  "mutation_chain.py": "548c44d342977ac3e796a6e91c5af3a03f7280d1dd8db3d90fd78cdd29f2464f",
  "mutation_runtime.py": "5997d8bc2ce16bd13daec237b536df97b9b7b64bb4d2688c017309e5d43a31f6",
  "mutation_gate.py": "69a8b42359c83862915cb3263defb1629eb69b8a9b0f61a455ca5e6a9397cb0d",
  "mutation_owner.py": "fec8752b1c651f6af979c720bddb3c838eb3a041c87c5b6178f44faea9a1520d",
  "mutation_runtime_bounds.py": "fcf239d2e7d285a87c449cffdb696bc2fa24b2c9d98685cb37df4ca28ed787f6",
  "systemd_deadline_reader.py": "3a13e910882fd37989125e8436ae7b64c962e48af9c2be1b07e8f2fb5953642b",
  "README.md": "257749f72f1534ca8c88c69e1c0ea1d1f3ac1696f600b01623064c98426d26e9"
}
```

## Mandatory parent prerequisites

1. Actually install and pass the financial owner gate for **r8**, source seal
   `c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086`.
   The sidecar rejects r7 or any earlier seal even with internally matching
   evidence. The actual financial result is still pending in this lane.
2. Retain/pin the exact successful result under
   `/root/baci-financial-owner.2ynkl9kc`. Review and pin independent protected
   state and full-chain DB baselines captured after the authorized financial
   passes. `mutation_chain.sql()` must be executed/reviewed by the parent; it
   has not been executed by this lane.
3. Review the renewed runtime request, JWT/private artifact pins, unchanged
   public service unit and complete sidecar source. Create the root-private
   mutation request and a new root-owned 0700 audit directory as documented.
4. Provide fresh actual replay heartbeat, snapshot/background completion and
   schedules. Worker start/finish must remain within 120 seconds, aggregate
   evidence within 60 seconds. Any refresh is separately parent-owned.
5. Reprove installed read-only public archive
   `882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2`
   and manifest `42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8`.
   The initial authenticated capability must be GET 200/false/max0 and both
   POST/PATCH 503. Final probes are GET/check only; no enabled mutation or
   provider payment probe runs in the enable gate.

The parent reported parser-repair provenance at
`/root/baci-interest-parser-repair.yzgOduMP/provenance/manifest.json`, SHA256
`1445e1b2a7f9e7e28801c8bd036b833fdbe8ec02facb5bc4d5e00c0c71e7de42`.
This is supplied context, not a remotely verified result from this sidecar.

## Local verification observed

- Seven focused suites: **59 tests passed** (5 chain, 6 contract, 8 gate,
  10 owner/recovery, 9 runtime, 10 runtime bounds, 11 deadline reader).
  All runtime commands are mocked.
- Coverage includes rejecting prior seals, missing actual financial results,
  boolean readiness, stale/future evidence, total-budget/history drift,
  compiled-artifact drift, shared snapshot credentials, extra environment,
  isolation drift, expired public unit conditions, interruption/partial rename,
  and failure after candidate creation, capability/readback or receipt writing.
- `pnpm turbo lint`: exit 1 in unrelated mobile-storefront lint/format checks.
- `pnpm turbo typecheck`: exit 2 in unrelated
  `apps/mobile-storefront/components/checkout/use-checkout-payment-controller.test.ts`
  at lines 153, 172 and 180 (argument compatibility and unknown result types).
- No unrelated failure was changed. No heavy build/install or complete
  monorepo test run was performed. No CodeRabbit/independent-agent review is
  claimed; parent source review remains a prerequisite.

## Preserved boundaries

Deadline remains October 6 at 15:59:10 UTC; no enable/restart at or after the
ten-minute cutoff. Company prefunding remains **10,000 kobo TOTAL**; original
goal principal remains 10,000 kobo. Old retired intent/history remains unchanged.
Saved cards and auto-debit remain off. Failed/expired recovery stops public
access and requires independent payment-state readback; it never infers that
an externally initiated payment was undone.

No parent file, env file, proxy, existing migration, production resource,
browser, live endpoint or provider was modified/contacted. No commit was made.

## Separately reviewed compatibility handoff

Parent financial evidence may call sealed `collect(run=wrapper)` with
`wrapper` imported from `systemd_deadline_reader.py`, recording the helper pin
and original r8 seal separately. The mutation runtime wraps only deadline
collection; active runtime service proofs are unchanged. Repeated oneshot
ExecStart records are strictly validated then joined, retaining original
record bytes/metadata. The unchanged sealed collector still pins fragments,
checks effective timers and matches ordered stop targets. No installed or
r8-sealed bytes were altered, and no actual financial start was attempted.

## Three runtime blockers repaired locally

`mutation_runtime_bounds.RuntimeBounds` now binds every executing shared import
to its actual absolute module path and matching sealed r8 bytes, independently
checks the exact r8 manifest, and retains source provenance. Parent execution
must load shared imports directly from the retained bundle's tooling/contracts,
not an identical worktree copy. The renderer must originate from the sealed
`tooling/runtime_scheduler.py`, with its sealed sibling `background-runner.sh`.
The installed root-owned 0444 `background.sh` must exactly equal that render.

Every financial/check container (background, snapshot, readiness, replay and
replay-check) must match unchanged sealed isolation and exact immutable-image
inherited environment; the mutation flag is forbidden even when false. Checks
repeat for active runtime proofs and immediately before restricted check starts.
The runtime collector requires an explicit bounds object and verifies it before
running restricted checks. This is additive sidecar code, not an r8 bundle edit.

Regressions cover modified wrappers fabricating successful reports, wrapper
changes mid-check, injected NODE_OPTIONS and flag/missing environment on all
five containers, inherited image mutation flags, identical off-root dependency
copies, changed/missing dependencies and changed/earlier seals. Parent review
and actual staging readback remain required; no enablement is claimed.

`systemd_deadline_reader.py` and `mutation_contract.py` were preserved byte-for-
byte during the three-blocker repair. Subsequently, the parent explicitly
authorized the reader's keyword compatibility repair below. The contract pin
remains unchanged; the eight-file map above reflects the new reader source.

## Reader keyword compatibility — next stage only

The local reader now exports `wrapper(arguments, run=originalcommand, **kwargs)`
and passes every keyword unchanged to the underlying command runner. The two
new regressions verify timeout/input_text passthrough for targeted deadline
reads and unrelated commands, retained argument/result identity, and refusal of
invalid commands despite keyword use. The reader's 11 tests pass, including the
unchanged sealed timer collector integration and duplicate ExecStart regression.
Test-file SHA256: `1115749c14d2eebb378a6f58748561f1e1529eaa095c986c386517b9e584005c`.

This new reader pin is only for the next public sidecar stage. The parent's
already-staged reader (`27fdc77e414a164fa7a76ceb360d1f726ac9e7feb31bac0f5c861d1f5a4e8af8`)
can remain unchanged behind the separately reviewed `compatible(arguments,
**kwargs)` adapter described in README. No staged financial or r8-sealed byte
was changed by this lane. Parent review/provenance and actual gates remain pending.
