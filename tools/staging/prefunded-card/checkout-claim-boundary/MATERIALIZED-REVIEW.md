# Materialized support: implementation review and evidence

Runtime closure SHA-256:
`e88aa1ad9d25ff7a6eacf16e66f8f642b840336eb251274a79a42ab0101e9653`.
The pinned migration is unchanged:
`05af1e6f87a118aefe6cf097569daa5dcf7e52922cfb1d1fdbff884b2f5d67ae`.
The old `da110c...e4aa7` source closure/root capture/receipt cannot authorize this
version; the renderer explicitly rejects the prior closure.

## Changed files

- `installer.py`: seal the additional lock asset; validate strict materialized
  OID/owner/populated pins; run exact guards BEFORE and AFTER materialized locks.
- `snapshot.sql`: hash all populated materialized rows, not selected fields;
  capture actual owner and population state; distinctly hash unpopulated state.
- NEW `materialized-locks.sql`: exact same-current-owner ALTER only, qualified
  schema/view/role identifiers quoted with `%I`, with catalog and relation lock
  checks through `pg_locks`.
- `installer.test.py`, `snapshot.test.py`, `guard.test.py`: retain predecessor,
  metadata, financial-row, paired receipt, foreign-refusal and identity checks.
- NEW `materialized-snapshot.test.py`, `materialized-locks.test.py`,
  `materialized_pg17_fixture.py`: disposable PostgreSQL 17 evidence.
- `README.md`, this report and `SOURCE-SHA256SUMS`: updated closure and handoff.

`identity.sql`, `guard.sql`, existing migration, financial SQL and every other
folder remain unedited by this materialized-support lane.

## Reviewed invariants

1. Original physical postgres/local-socket/database/role/deadline checks run
   before installer DDL. Existing catalog and regular-table locks are retained.
2. The first full current snapshot must exactly match independently reviewed
   evidence, including all rows, materialized contents and permanent metadata.
3. Materialized locking checks fresh exact evidence again, required held catalog
   locks, disabled event-trigger state, captured relation OID, current catalog
   owner name/OID and population state. No caller-selected replacement owner is
   accepted. Role and relation catalogs remain locked while names are resolved.
4. ONLY `ALTER MATERIALIZED VIEW ... OWNER TO <that exact same owner>` runs.
   AccessExclusiveLock is checked as granted to this backend. Every materialized
   relation in the captured inventory is locked, including unpopulated views.
5. Another full snapshot/guard runs AFTER all materialized locks and BEFORE the
   pinned two-function rewriter. A racing refresh/data/catalog change aborts;
   no pre-lock snapshot is relied on as the final frozen baseline.
6. Original predecessor hashes, unique anchors, original full function metadata
   and postflight remain enforced. Only the two intended `prosrc` fields may
   differ. Financial rows, view owner/ACL/reloptions/definition/state and all
   other captured metadata must remain byte-equivalent at the hashed level.
7. Unpopulated state uses actual `pg_class.relispopulated=false`, count zero and
   a hashed JSON marker distinct from populated empty data. It is not omitted or
   represented as ordinary empty contents. Foreign relations still block and
   are never queried. No unsupported-relation waiver exists.
8. Generated SQL contains no REFRESH, alternative-owner change, financial DML,
   new grant, phase reset or provider action. Default ROLLBACK and independently
   reviewed paired apply receipt remain unchanged. Root custody/review and
   source sealing remain parent-owned trust boundaries.

No additional valid source blocker identified in this post-implementation
review. Catalog locks have cluster-wide impact; all writers/refreshers and
sequence writers still require parent-coordinated quiescence. Lock/snapshot
timeouts deliberately abort rather than weaken preservation.

## Measured validation

RED on PostgreSQL 17: old source refused populated materialized views and omitted
the unpopulated relation from row pins. The same two tests then passed.

Final focused results: **46 tests pass**, none skipped:

- 19 renderer tests, including prior-closure refusal and strict materialized pins.
- 8 existing snapshot, 6 guard and 3 identity tests on disposable PostgreSQL 18.
- 3 materialized snapshot and 7 materialized lock/core tests on PostgreSQL 17.11.

PostgreSQL 17 tests observe granted AccessExclusiveLock through the transaction,
and demonstrate both regular and CONCURRENTLY refresh waiting specifically on
the materialized relation before lock-timeout refusal. No refresh succeeds.
Same-owner ROLLBACK and COMMIT preserve full row hashes and permanent metadata,
including explicit ACL and reloptions. A quoted schema/view and non-postgres
quoted owner are preserved. The pinned rewriter core rehearses and commits with
only its two body changes, leaving all financial/materialized hashes unchanged.
Foreign relations, absent catalog locks and wrong owner/OID/population/data pins
refuse. All files remain under 300 lines. No dependency installation/full build.

## Parent next gate

Independently verify the updated five runtime files and fixed migration pin.
Quiesce every relevant writer/refresher, perform a NEW read-only root capture
covering the eight actual views and all other permanent relations, independently
review it and rehearse with the default ROLLBACK. Verify restored full baseline
and metadata before a separately reviewed paired apply approval. PostgreSQL
17.11 local tests are not a root PostgreSQL 17.6 rehearsal or apply.

No root/remote actions, financial/provider actions, live view refreshes or
permanent installation occurred in this lane. Local disposable fixtures are
synthetic and never evidence of real money.
