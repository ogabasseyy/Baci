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
of an **uncommitted** cutover. They do not exercise an independently built
recovery web/worker release, a full production schema, real ingress drain, a
committed-cutover recovery drill or a verified backup restore. The newer
reconciliation guard is local, unreviewed and undeployed.
