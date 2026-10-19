# Source-only replay claim fence candidate

No executable installer, network access, token issuer, role/grant changes,
registry, provider proof, payment or ledger operation is supplied here.
The parent owns evidence collection, signing, independent review, rehearsal
and any later approved installation.

## Pinned contract

- Receipt database: `postgres`, physical system `7686901100561231906`.
- Installer: actual superuser session `supabase_admin`; no impersonated session.
  Confirm this installer login independently before root rehearsal.
- Routine: `public.claim_piggyvest_staging_receipts(integer,integer)`, OID `16487`.
- Owner: `pvb_staging_replay_executor`; security definer; volatile; PL/pgSQL;
  exact `search_path=pg_catalog` and the two supplied EXECUTE ACL entries.
- Original body SHA256: `3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc`.
- Original definition SHA256: `650e050f359e295abc9bcb306f33a05afa3ffa14bc128f4a7b3b93faaaa5b824`.
- Claim: `replay_claimant_generation=1a420a7b-0c17-4312-84dc-d276a32f19f4`.
- Exact signed role/audience: `pvb_staging_worker` / `pvb-staging-receipts`.
- Numeric integer expiry: `1791302350`, exactly `2026-10-06T15:59:10Z`.

The copied baseline body independently matches the supplied body hash.
Disposable PostgreSQL also reproduces the supplied full definition hash.
The mounted PostgREST configuration hash supplied by the parent is pinned in
`contract.py`; this renderer cannot read or independently authenticate that
remote configuration or the JWT. `request.jwt.claims` is trusted only through
the parent-verified PostgREST JWT/role boundary. Direct superuser SQL can set
that context and is outside this credential fence's authentication boundary.

## Rendering and limits

`renderer.render_transaction(original_definition)` requires the exact captured
`pg_get_functiondef` text and defaults to one transaction ending in `ROLLBACK`.
The separate explicit `mode='commit'` changes only that final terminator.
There are no public clock, generation, scope or baseline-pin overrides.

The first statement inside the existing routine is a nested refusal block,
before parameter checks, exhausted updates and claim selection. It changes no
underlying body bytes after that insertion. Bad/missing/duplicate claims,
wrong typed identity/expiry or an expired SQL clock produce a sanitized 42501.
Resolution, quarantine, retry scheduling and existing privilege boundaries
are not modified. This is a generation fence, not a process-singleton proof.

The owner transaction takes a bounded SHARE ROW EXCLUSIVE lock on `pg_proc`
and SHARE locks on both receipt tables. The catalog lock temporarily blocks
other routine DDL in this database. It verifies the baseline, replaces only
the target definition, and compares all other `pg_proc` fields and complete
receipt/quarantine rows before finishing. Existing owner/ACL/configuration
must remain unchanged. No trigger is dropped or disabled.

Before either rehearsal or commit, the parent must quiesce every claimant and
drain in-flight RPC transactions: a call already executing the old body is not
retroactively fenced. Preserve natural backoff and leases; do not clear them.
After independently reviewed rollback, collect a fresh baseline and verify
the actual mounted configuration, signed new JWT/server acceptance and the
capability-complete daemon. Keep predecessor files and the fixed deadline.
Do not start a second instance sharing the new generation credential.

## Focused disposable tests

Run each `*.test.py` directly with `python3 -B`; unittest discovery does not
load dotted filenames. The PostgreSQL suite uses PostgreSQL 17, a newly
initialized private `/tmp` Unix socket, no TCP listener and no inherited PG
connection settings. It creates no roles or grants and drops its cluster.

The SQL cases use synthetic claim context, not a minted/signed JWT or provider
signature. A test-only BEFORE UPDATE sequence probe is non-transactional, so
the suite detects even an exhausted-row mutation later rolled back by refusal.
The original ungated body and a deliberately misplaced gate both fail that
regression; the first-statement fence passes. Test-private catalog pins and
one expired deadline fixture never enter the production API or emitted pins.
