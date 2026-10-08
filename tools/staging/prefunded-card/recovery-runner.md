# Staging first-card recovery runner

This is a bounded one-shot staging entrypoint. It resumes the existing
`createPrefundedCardCheckoutRecoveryComposition` over its read-only unresolved
intent scan, and persists only its keyset cursor in a mode-0600 file. State is
scoped to the physical database name and system identifier, integration,
merchant, treasury binding, business, and fixed expiry. The state directory must
be `/var/lib/baci-staging/prefunded-first-card`, mode `0700`, and owned by the
runtime UID. No checkout, initialization, charge, treasury transfer, or receipt
is created by the runner. A crash before atomic cursor replacement replays the
same page; provider verification is read-only and durable promotion remains
idempotent in the existing checkout storage.

Run only through `tools/staging/prefunded-card/recovery-runner.sh`. The wrapper
requires Linux `flock`, verifies the private directory and lock file, holds file
descriptor 9 for the whole process, and launches TSX with the React server
condition. The CLI independently checks that descriptor 9 refers to the same
private lock inode. A second invocation returns only `{"status":"busy"}`.
Each pass is limited to four pages of four intents. Its 240-second runtime
budget is cooperative and checked between pages; the wrapper has no hard
timeout. The staging service must set `RuntimeMaxSec=240` (or a stricter
equivalent) to enforce a hard bound. The lock is held until process exit and
the kernel releases it on crash. The runner also fails closed at
`2026-09-29T15:59:10Z`.

The runtime must inject `PREFUNDED_CARD_CHECKOUT_RECOVERY_RUNNER_CONFIG` as one
JSON value containing the exact runner `scope` (including `databaseName`), the
existing recovery composition's `scope`, `authorizerDatabase`, and `provider`,
and the exact `stateDirectory`. Keep that value in the staging secret manager or
the process environment; do not put it in shell history or print it. The
authorizer executor independently pins the staging host/project and physical
database identity. Runtime requires a restricted executor session with a LOGIN
credential provisioned by the owner; the installed foundation executor roles
remain NOLOGIN until that provisioning. The CLI emits only redacted
counters/status. Nothing in this handoff configures a production service or
enables checkout.

## Caller ordering and remaining installation

The eventual staging caller should complete one recovery pass, then invoke the
existing `composition.tick()` dispatcher so newly promoted collections can
enter the existing transfer workflow. Keep signed PiggyVest receipt replay on
its existing authenticated webhook/evidence path: replay the original signed
payload when delivered, commonly after a transfer tick, and never synthesize or
replay receipts from this cursor. If a caller has a previously received signed
receipt queued, replay that evidence before its next tick so projection state is
current. This runner does not implement an inbox or a daemon.

The Python flock smoke test proves kernel-level two-process exclusion and lock
release on process death; it does not exercise the shell wrapper end to end.

The parent must still provision the staging runtime identity and private state
directory, deliver the configuration without logging it, and wire the one-shot
command into the reviewed staging schedule around `composition.tick()`. The
existing services and checkout routes were reported absent/404 and the isolated
database compose has no host ports, so this command cannot run against that
compose as-is. No service, role, migration, database function, deployment, or
live payment is installed by this change.
