# Sealed notification-only CLI

Implemented executables: `notification_producer.py` (offline packaging) and
`notification_cli.py` (root RO preflight, or explicit bounded `--apply`).
No financial runner, Root.prepare, grant, password refresh, public/replay restart,
unit rewrite, enable, credential installation or payment path is called.

## Inputs to producer

Provide a private JSON specification with exactly:

- `targetRoot`: approved new direct child of `/root`, named `baci-notification-*`.
- `approvedSnapshotPath` / `approvedSnapshotSha256`: local exact bytes/hash of
  the independently reviewed CURRENT full postcredit physical snapshot, not
  merely the scope report and not a latest snapshot accepted automatically.
- `public`: the existing reviewed public-only manifest's `reviewed` object.
  Source pins are deterministically rebuilt for this package plus authenticated
  R2. Its public container/config/manifest authority fields remain unchanged.
- `publicRunning`: actual approved current public state (R7 running per parent).
  The CLI independently verifies the actual container
  and unit; this flag confers no start or auth authority.
- `authRows`: finite (at most 32) exact parent-reviewed `auth.*` transitions tied
  to authorized fixture login acceptance. Each is exactly `{before,current}`;
  each witness is exactly `{oid,count,sha256}`, with unchanged positive OID,
  nonnegative count and full SHA256. Names must match ALL and ONLY changed Auth
  table/sequence witnesses between the authenticated historical R2 audit and the
  authenticated explicitly approved current snapshot. Fresh actual state must
  equal approved current state. No non-Auth/financial/catalog/grant exception,
  unlisted change or automatic latest rebaseline is permitted. This is explicit
  reviewed whole-table transition acceptance, NOT proof of historical per-row
  preservation or independent attribution to the fixture actor. Parent must
  independently approve that attribution before sealing; the CLI does no login.
- `expectedEvents`: finite exact reviewed goal/key/type/content-hash forecast;
  empty permits only expansion of existing events during restoration proof.

The standalone scope input is the actual sanitized capture:
`/private/tmp/baci-notification-scope-20261003.json`, SHA256
`5dfda373c8461831031380c9f2defeff49f3e28a37ca049fd006f578e40e3d09`.
The producer refuses any other scope bytes. Current approved snapshot bytes and
the explicit Auth transition/public reviewed specification are still required;
their hashes/values are deliberately not invented by source code.

Existing authenticated dependency bytes are locally available in
`/private/tmp/baci-public-resume-r7.kCdy5f6F`. Five exact dependency SHAs are fixed
in the CLI; it does not use newer files by import order. Root authenticates the
original R2 release at `/root/baci-existing-continuation-r2.w2fa2hp8`, seal
`b236f0d961601aa0b7b305605c2554f42c241180a86de733cc6b078240a54613`,
before importing any dependency. The original Context performs its actual
anchored transitive closure, receipt infrastructure and cutover-lock checks.

## Produce / execute

Offline only, from canonical repository:

```sh
python3 tools/staging/interest-bridge/notifications/notification_producer.py \
  /private/tmp/notification-reviewed-spec.json \
  /private/tmp/baci-public-resume-r7.kCdy5f6F \
  /private/tmp/baci-notification-scope-20261003.json \
  /private/tmp/notification-reviewed-package
```

It returns exact package/manifest SHA256 and fully rooted preflight/apply
commands with the approved target path and real seal. It writes only a new local
flat package/archive; all archive members are regular root:root 0600 and no
installer or root command is executed. Parent independently reviews the source
seal and deploys those exact bytes to the approved root:root 0700 directory.
Do not use the synthetic producer-test snapshot for a real package.

Run the emitted `/usr/bin/python3 -I -S -B .../notification_cli.py SEAL` command
first. Without `--apply`, it performs only real RO proofs and private auditing.
The emitted command ending `--apply` executes the bounded timer-only action.
No source work here has performed either root command.

## Actual runtime proof

Both the existing cutover lock and `/run/baci-notifications-renewal.lock` are
held and rechecked. ReadonlyRoot does NOT construct/prepare the old financial
runner. It authenticates repair/reboot/reminder evidence and initializes the
actual existing Context, then uses the pinned R2 PublicCallbacks audit/completion
collector. Its explicit quiescence mapping removes ONLY the three owned
notification unit names from the old stopped-unit loop. All other financial,
native/competitor, source/profile/configuration and drain guards remain real.
Public state is independently checked and never started here.

Physical scope collection composes the ORIGINAL authenticated financial snapshot
SQL, fixed role guard and frozen scope query into ONE repeatable-read READ ONLY
transaction and one ROLLBACK, requiring exactly two JSON output frames. No
snapshot/table rows are masked or invented. The approved snapshot must equal the
actual one; historical differences must equal the exact reviewed Auth witness
set and nothing else. The RO collector requires postgres, not supabase_admin.
Full
current Auth/catalog/financial state is then unchanged
before/after activation, except the narrowly validated notification tables.

Only after these proofs does the CLI create private derived postcredit/scope
baseline files and call the bounded existing timer contract. Those files derive
from authenticated, approved actual inputs, not arbitrary latest rebaselining.
StartUnit is issued once for the existing ordinary timer. Actual D-Bus job IDs,
bounded settlement, unchanged Oct6 stop timer and independent RO readback prove
initial restoration. Failure cleanup stops only owned timer/service. Pending
jobs, lost ACK, auditing or lock-cleanup failure remain nonzero/unconfirmed.
Final seal or audit refusal after submission independently withdraws only the
owned timer/service using the held lock and exact unit pins, not the failed seal.
StopUnit uses replace and both units are attempted independently. Cleanup is
confirmed only by actual zero-PID, inactive/failed state and no owned jobs within
30 seconds. Public R7 unit commands use LoadUnit plus exact encoded object paths;
the authenticated owned_public_stop dependency loads before its runtime.

Public command proofs use structured `Service` D-Bus `a(sasbttttuii)` properties,
preserving the complete shell argv and repeated ExecStart entries. No lossy
systemctl display or shlex flattening is accepted as executed command proof.

Zero tokens is reported honestly, not a timer activation prohibition or push
delivery claim. Private audits retain actual baselines and final result. Console
JSON contains only redacted status/counts, never credentials, tokens or raw DB
error output. No automatic financial or timer retry exists.
