# Current postcredit notification inspection

`notification_resume.py` is parent-injected source, not a live CLI or execution
approval. It never changes role validity, passwords, grants, unit bytes, deadline,
caps or financial state. It never starts the delivery service or ordinary timer.
The existing normal worker calls `savings_notifications.enqueue_due()` before
delivery. Normal notification processing is owner-authorized; this helper remains
inspection/check-only until its current scope inventory is independently bound.
No alternative worker or broader privilege is introduced.

## Source-derived current unit pins

The existing `savings-engagement/worker_contract.py` reproduces predecessor unit
pins. Applying only the already-reviewed October deadline substitutions and check
`RemainAfterExit=yes` produces the following hashes, matching parent-reported fresh
read-only inventory. This is not independent live verification by this agent.

| Existing unit | SHA-256 |
| --- | --- |
| delivery service | `1389b96374891bec54d367f779f822f5cfb0314878e27a6a65a3e5a86a957d2d` |
| check service | `14cb3de58428a24ec5fdec10d3fc0b1b8825a09ae10a0091170257e6930973fd` |
| ordinary timer | `5b8ed97034b66bc0e68a8e585ae93cd9a2186ddd3bacd534481e309ce3003fbe` |
| deadline service | `0611c0d1c6ac5b0336e5e4e900e6e3f7393672a261edb52274b495f7cdc5874d` |
| deadline timer | `48f37a81d85be48ba5529a61ea8931c80bae3aaf14f6cb9ba25426afb1d6a3ac` |

Inspection requires all four non-deadline units inactive/dead with no process/job,
deadline active/waiting for exactly October 6 15:59:10 UTC, original stopper
targets, no drop-ins/reload, and exact protected unit/worker/CA bytes. It binds a
fresh authenticated completed report and full actual snapshot to the parent's
pinned retained postcredit baseline. It preserves the entire old-goal/non-target
history and hidden hashes, reminder `914e9941-c9c1-44a1-9879-1de3e54ac365` and one
first contribution `ad00ea01-65f0-4594-b4f9-71cb609c6aaa`. No stripped witness or
latest-snapshot rebaseline is accepted.

## Parent inputs still required

Seal the helper, imported validator closure and every actual callback origin
before import. `reviewed` contains exact `sources`, `baselinePath`,
`baselineSha256`, `assets`; the baseline must be retained authenticated completion
evidence plus notification activity, not a caller assertion of success. The
baseline path/hash has deliberately not been invented here.

`read(path, mode)` must implement root-owned single-link stable no-follow reads,
safe ancestors and actual metadata. `collect()` must perform actual RO queries
and cryptographically authenticated receipt/provider collection, returning exactly
`completed`, `protectedSnapshot`, `activity`. Activity contains typed nonnegative
`activeStorefrontTokens`, `deliveryRows`, `withTicket`, and the exact role fields
checked by the helper. Counts are scoped to existing actor
`baeb4f5a-54c7-4d46-8b07-9e69ab2907b3`, synthetic merchant/customer, and exact new
contribution; no token strings or credentials enter the report. Normalize actual
role expiry to the equivalent fixed UTC instant, not a widened validity.

`exclusive()` proves the held global cutover lock. `state()` supplies actual fresh
effective properties, per-unit pending jobs and independently parsed deadline
epoch. `job_state(check, submittedAt)` proves the exact submitted job identity,
fresh observation, terminal removal/completion, no pending job or activation.
`run` is bounded, captures private output and never logs credentials. No mocked
callback in the offline tests is a deployable root adapter.

Inspection invokes no command. Optional `restore_check=True` starts only the
already-installed readonly `--check` unit once, requires fresh successful retained
oneshot execution and terminal job proof, stops that same unit, then proves all
protected state unchanged. Timeout/failure attempts only owned check-unit cleanup;
pending or unknown jobs leave cleanup unconfirmed. No timer enable/start, delivery
worker start, enqueue, receipt claim or database write is exposed.

Zero active storefront tokens is reported as `pushReadiness=no-token`, never
device delivery. Parent currently reports zero tokens and zero delivery rows or
tickets for the contribution. Phone registration and real receipt/device evidence
remain separate owner-authorized gates; do not create dummy tokens.

Focused offline command:

```sh
python3 tools/staging/interest-bridge/notifications/notification_resume.test.py
```

Tests use synthetic financial projection fixtures plus the actual captured
reminder witness. Compiled worker/CA reads are mocked explicitly; their actual
deployed byte pins remain mandatory in source. These tests are not live delivery
or permission proof. Ordinary schedule restoration is authorized in principle,
but needs fresh inventory proving every eligible goal/event/token belongs to the
approved actor/merchant. The next bounded restoration must permit only expected
notification/delivery changes, preserve existing event identities without
duplicates, and keep financial/Auth/catalog state unchanged. It must verify the
already-armed deadline before starting only the existing ordinary timer, without
role/grant/deadline changes. Zero physical tokens is a delivery acceptance blocker,
not a permanent prohibition on restoring the authorized scheduler.
