# Automatic staging receipt worker

## Deployment

Dedicated container: `pvb-staging-replay` on the isolated VPS. It uses only the internal `pvb-staging-receipts` and `baci-isolated-savings_database` Docker networks. There are no published ports, production credentials, provider API credentials, Docker socket or database-admin credentials in this worker.

The process runs as UID/GID 65532, with a read-only root, all capabilities dropped, no-new-privileges, a writable bounded `/tmp` tmpfs, PID/memory/CPU limits and bounded rotated logs. Existing Node image is pinned to `sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`.

Each pass runs in a separate child, with a 90-second kill timeout. Passes never overlap within this process. Successful passes wait 60 seconds; failures wait five minutes. A child receives no secret arguments. Only validated counts are forwarded from child output. Heartbeat indicates recent successful execution, not a fully reconciled backlog or customer launch readiness.

The receipt database enforces retry eligibility with a 30-minute exponential backoff, capped at 24 hours and ten attempts. Permanent quarantines are excluded from automatic claims. Expired processing leases are reclaimable, and transitions require an unexpired matching claim token. A quarantined verification event can never credit the ledger.

## Authority and configuration

`replay-runtime-storage.sql` was installed atomically on receipt cluster `7686901100561231906`. The worker no longer has direct receipt-table or column access; its RPCs run under a separate restricted NOLOGIN executor. Intake privileges remain intact. App calls use the restricted app-worker role and pin cluster `7685292944002592802`.

Configuration is mounted read-only from `/home/bassey/pvb-staging-replay/config/config.json`. It contains only restricted receipt/app JWTs, the staging receipt decryption key, environment marker and database identity pins. Do not print or commit it. JWT signing secrets are not mounted. Tokens expire **2026-09-26 12:10:21 UTC**; the worker refuses them three minutes before expiry. Rotate through a trusted operator before then; no token-renewal automation was installed. Reloaded configuration must preserve role restrictions and a maximum seven-day token lifetime.

Receipt schema backup: `/home/bassey/pvb-staging-receipts/review-backups/receipt-before-runtime-20260919.sql`. Do not blindly restore a whole schema. Safe immediate rollback is stopping only the worker; intake continues durably storing events.

## Operations

Read-only checks:

```sh
ssh bassey@82.29.190.219 'docker inspect pvb-staging-replay --format "{{.State.Status}} {{.State.Health.Status}}"; docker logs --tail 20 pvb-staging-replay'
```

Stop this worker only:

```sh
ssh bassey@82.29.190.219 'docker stop pvb-staging-replay'
```

Build source: `apps/web/tools/piggyvest-staging/replay-daemon.ts`. Bundle with esbuild for Node 24, ESM, `react-server` condition and a `createRequire(import.meta.url)` banner. Deployed bundle path: `/home/bassey/pvb-staging-replay/replay.mjs`. SHA-256: `3f8f5eb715da730af816ebb9d1b5a8f6ad6fc3696078a3452d12d0cc83ed8377`.

Never manually reset a financial receipt to replay without reviewing the recorded effect and idempotency evidence. Unknown account mappings require independently verified ownership, not a guessed mapping to clear a queue.

## Validation scope

124 focused replay/runtime tests passed, followed by all **265 staging-tool tests** through the repository Turbo test task. Coverage includes restrictive transport, claim accounting, duplicate recognition, timeout handling, summary redaction and runtime configuration. A dedicated TypeScript check includes the staging tools (the ordinary app typecheck excludes them). Repository typecheck passed. Repository-wide lint still has unrelated existing failures.

Database regression proved retry/backoff, permanent quarantine exclusion, expired lease recovery, attempt ceiling, RPC-only worker permissions and continuing intake on a disposable synthetic database. The installed privilege audit passed. This deployment does not activate the customer-facing savings application or prove new provider funding settlement.

## Fresh live proof

A new explicitly synthetic, non-financial signed ping was POSTed to the public staging receiver: HTTP 200, `received=true`, `durable=true`, `duplicate=false`. Receipt ID: `41b16993-bf62-4dc0-a92b-8fa29e5a4090`.

At **12:19:28 UTC**, the automatic worker reported `claimed=1`, `processed=0`, `quarantined=1`, `retryable=0`, `resolutionFailures=0`. The database confirmed `quarantined / unsupported-event / attempts=1`. The next scheduled pass at 12:20:29 UTC claimed zero: permanent quarantine was not repeatedly retried. No manual replay triggered this processing. This proves automatic authenticated receipt handling and safe rejection, not a newly settled financial credit.

Repeating that exact public request returned HTTP 200 with `durable=true`, `duplicate=true` and the same receipt ID. The existing financial ledger remained two rows / 20,000 kobo. Public webhook GET and staging `/auth/v1/health` both returned 200.

Restarting only `pvb-staging-replay` succeeded, followed by another zero-claim successful pass. Restart policy is `unless-stopped`; no other container was restarted. This tests worker process restart, not a VPS reboot.

Backlog after verification: two processed financial receipts, five legacy quarantines labelled `undecryptable` by the older adapter, the new unsupported verification ping, and one unmapped receipt deferred with `worker retryable`. Its first eligible retry is 12:43 UTC; it has not been assigned an invented customer mapping. Worker health does not imply this backlog is reconciled.

At 12:43:48 UTC the deferred receipt retried automatically and remained uncredited (`retryable=1`, `resolutionFailures=0`). The failed-pass backoff deliberately withheld the success heartbeat, temporarily marking the container unhealthy. At 12:48:49 UTC the next pass completed successfully with zero claims. This is a surfaced reconciliation failure, not a reason to invent a mapping or silently acknowledge financial success.

Subsequent read-only provider/receipt reconciliation identified that deferred event as funding of the business main wallet, not a customer subaccount. A reviewed exact-ID/digest operator transaction permanently quarantined it as unsupported for customer savings; it no longer retries. Audit provenance is in `piggyvest-business-wallet-receipt-2026-09-19.md`. Customer ledger remains two rows / 20,000 kobo, and the worker remains healthy.

CodeRabbit completed a scoped review (14 findings). Its SQL reapplication suggestion was addressed with `DROP CONSTRAINT IF EXISTS`. The two intake findings were independently checked: the header mutation typechecks, and an empty signed body is rejected by database constraints with a fail-closed 503 rather than acknowledged without storage. No speculative provider response contract was introduced. Minor suggestions about existing test organization, comments and intake refinements are deferred; this is not a blanket clean verdict for the entire branch.
