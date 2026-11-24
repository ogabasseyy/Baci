# Private draft cutover: committed recovery gate

Status: **not qualified for production cutover**. This is a release-review
checklist, not an instruction to execute a migration. The production snapshot
and the local test evidence are recorded in
[builder submission evidence](evidence/builder-submission-oauth-contract.md).

The privacy contraction removes four draft columns from `page_configs` in a
committed transaction. The normal application build on the current candidate
has `BUILDER_PRIVATE_STORAGE_ENABLED = false`; code paths for existing merchant
draft reads, writes, provisioning and the layout worker depend on that switch.
Consequently an old or disabled-private-storage build is not a demonstrated
rollback target after contraction. Flipping a switch back, restoring public
draft columns, or reversing the migration is not a safe recovery plan.

## Required release evidence

1. Identify an immutable, reviewed **recovery web and worker build** that uses
   private draft adapters with the ChatGPT builder, owner preview and approval
   independently disabled. Record source commit, build and dependency digests,
   configuration, database compatibility and the exact deployment procedure.
   Confirm it can be deployed with the repository's prebuilt flow. No such
   production recovery artifact has yet been qualified.
2. Demonstrate on a disposable full-schema environment that the recovery build
   works **after a committed cutover**: existing owner and authorized staff can
   read and edit private drafts; unauthorized users cannot; published pages
   remain available; new merchant provisioning and the native layout worker
   use compatible paths; connector admission and approval remain disabled.
   Include old in-flight worker termination, restart and persisted edits.
3. Identify and test the actual controls that stop new draft writes, worker
   claims, connector operations and publication before contraction and during
   recovery. Verify all instances have drained; a one-time empty queue query is
   not a drain. Record who controls each boundary, its health signal and the
   verification required before reopening. If traffic cannot be stopped and
   drained reliably, do not start the cutover.
4. Rehearse failure after the transaction commits: keep admission closed,
   switch to the pinned compatible recovery build, verify private-draft RLS and
   existing storefront availability, then reopen only the individually proven
   paths. Test any data recovery separately against a verified backup and its
   restore procedure; preserve post-cutover writes and do not silently revert
   the database to an earlier point in time. A database backup without a tested
   recovery procedure is not rollback evidence.
5. In the real maintenance window, independently recheck live data and migration
   state under the documented locks, reconcile conflicts, and verify the exact
   artifact and operator permissions. An uncommitted transaction can be rolled
   back; after commit, retain private storage and use the qualified compatible
   recovery path. If that path fails, keep the affected operations closed and
   investigate rather than expose private drafts or replay uncertain mutations.

## Evidence currently available

Disposable PostgreSQL 17 tests cover a committed cutover's private draft RLS,
owner/staff access, anonymous denial and public projection, as well as rollback
of an **uncommitted** cutover. These earlier checks did not include the full schema or live process drain.
The disposable rehearsal below adds a full-schema database receipt. The
coordinated production migration remains pending.

## Disposable database rehearsal

Run the following command from the isolated candidate checkout. The replay
creates and owns a fresh local Supabase project. The SQL check refuses a
database that already has merchants and commits the contraction in that
disposable project. Run it separately from other SQL checks because the
legacy columns are intentionally absent after the rehearsal.

```sh
pnpm --filter @baci/web db:replay:chronological \
  --sql-check supabase/tests/builder_private_cutover_recovery.sql
```

The rehearsal seeds an old processing job and confirms the contraction is
blocked. It marks that synthetic job stopped, commits the contraction, then
reconnects to verify migrated draft access, an owner write, a staff write,
foreign and anonymous access restrictions, and the existing public page.
A further reconnect checks the committed edits and applies a synthetic native
worker result. This exercises the native SQL adapters. The production web
and worker artifact, actual process drain and backup restore require separate
rehearsals.

On 19 November 2026, the rehearsal passed against the full chronological
replay for candidate `8b7f9a6eb67ca7115353e92115f8e30fa1941b34`. The pinned
Supabase CLI was 2.111.0 and the database was PostgreSQL 17.6. The replay
matched the baseline effect digest
`71cba5629959c75352726e26cafcbfec8de99b1b52d10e6ad70fd85f07e4d253`
before applying the current-tree migration set and running the SQL check.
No production database was used. A separate isolated Next.js CI compile
of that source passed with private storage enabled and ChatGPT linking,
owner preview and owner approval disabled. A compile does not qualify a
runnable prebuilt release or its compatibility with the deployed worker.

The VPS layout job has two entry points. The event path uses the
`baci-ai-storefront-trigger.service` user service and the scheduled fallback
runs every ten minutes. Both take `ollama-workload.lock` followed by
`ai-storefront-jobs.lock`. The worker operator needs to suspend both sources
on each host, account for detached child processes, and observe the worker
lock and job lease state before declaring it drained. The web operator also
needs a demonstrated gate for editor saves, native provisioning, layout
enqueue/apply and publication on every serving artifact. Closing the VPS
entry points alone leaves those web paths active.

The trigger starts detached processes that wait for those locks. In the
24 November 2026 synthetic Linux rehearsal, stopping the listener rejected new
requests, but a waiter started after the first job released its locks. Both
processes had to exit before both locks were available. During a cutover,
verify the trigger and scheduled fallback are fenced on each host, wait for
detached children to settle, then hold both locks in the documented order
through the cutover. Recheck pending, running and processing layout rows
under the database cutover lock. The production worker release lock helper
covers the scheduled locks during promotion but does not stop the storefront
trigger service. Coordinate that stop separately.

The same rehearsal built standalone web and layout worker artifacts from
`4ed8b4eeb4`. A custom-format backup after committed contraction restored into
a fresh database on the disposable Supabase instance with cron disabled. With
GoTrue and PostgREST, the owner could edit, staff could read the edit, foreign
and anonymous callers were denied, and the published config stayed readable.
The built worker completed an owner-enqueued job through a deterministic local
provider fixture and released its database lease. The hosted web write fence
and production release artifacts still require qualification.
