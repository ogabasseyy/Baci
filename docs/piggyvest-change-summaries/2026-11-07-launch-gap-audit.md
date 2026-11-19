# PiggyVest launch-gap review — 7 November 2026

This review compares paused PRs #3940 and #3952 with the current, slimmer
main-wallet-and-savings implementation. It does not enable payments, apply a
migration, provision a login, install a worker or access customer accounts.

## Reuse the merged legacy-money approach

The owner paused #3940 and closed the related engine-schema PR #3948 after
adopting PiggyVest as the money system of record. Do not restore that engine
as a prerequisite for this launch. Main already contains:

- #3969: the reviewed manual legacy balance-list and zero-out runbook;
- #4015: goal funding uses the PiggyVest main-wallet balance;
- #3971: new provider deposits are recorded in the PiggyVest ledger only.

The duplicate-customer read and failed-flip-hook retry findings on #3940
concern its unmerged primitives. Those functions are absent from main and
should not be introduced merely to fix those deferred findings. The original
draft, branch and review findings remain available for any future revival.

One independent test idea is retained from #3940: compare the readiness
capability lists with explicit function grants recorded in migration source.
The adapted contract covers the current onboarding and goal-provisioning
roles without importing `is_backed` or the obsolete backing-state model. It
checks source declarations; disposable/live catalog permission checks remain
a separate requirement.

## Reuse the current capture and replay pipeline

Main already captures deliveries durably, verifies their stored bytes on
replay, preserves recorded signing-family authority, defers incomplete keys
and kill-switch pauses, and quarantines unprocessable events. Reuse that
pipeline rather than replacing it with the old PR's version.

One #3952 finding also affects main: the replay completion predicate could
accept a 2xx result carrying `keySetIncomplete: true`. The fix excludes all
explicit incomplete markers from completion. The marker remains recoverable
at both early and exhausted attempts, without changing the existing rule
that an actually successful replay may complete with an unrelated key absent.

## Remaining worker boundary

Main has no production caller or schedule for `drainPiggyvestWebhookCaptures`.
The dedicated-login host worker in #3952 is relevant to unattended recovery
even though the old draft was paused. Prepare only that missing boundary,
retaining main's newer capture/replay protections and disabled defaults.

The refreshed draft also preserves the dispatcher's kill-switch marker on
the worker replay path. A pause therefore refunds the processing attempt
instead of eventually parking a valid deposit. Obsolete service-role
adapter copies are omitted: main's receiver already uses a separate
restricted intake login, while the drain uses only its own capability. The
drain now reuses main's database link helper too, retaining verified TLS and
fixed-role checks while supporting the shared session-pooler and forwarder
configuration instead of assuming a direct connection.

Until a restricted worker and schedule have been independently verified,
do not attest `PIGGYVEST_WEBHOOK_CAPTURE_DRAIN_SCHEDULED=true`: the receiver
must retain its default 503/provider-redelivery behaviour after an incomplete
processing attempt. Durable capture alone is not unattended recovery.

SQL tests and import-graph checks do not prove a deployed schedule. Any later
production provisioning, activation or financial acceptance remains a
separate owner-controlled step. The recording account is excluded.

CI follow-up: the worker schedule remains literal in `deploy.sh`, within
the existing size limit, so both deployment renderers can consume it. A
portable test runs the actual isolated release renderer against this block. The
kill-switch source sweep now excludes comments when deciding whether code
constructs an enable flag; it retains its existing literal/construction
detection and separately checks real environment reads. A readiness error
code alongside a documentation-only flag name is not a bypass.

The review follow-up also adds claim renewal and inline-completion coordination
in one append-only migration, gated by `claimRecoveryVersion: 1`. No new
login or grant is introduced. The host uses its supplied environment throughout
replay, defers unavailable families, claims work one row at a time within an
admission budget, and monitors durable review counters on every enabled pass.
The existing three restricted database statements remain the only worker
entry points; renewal is an explicit command on claim-bound resolution.
