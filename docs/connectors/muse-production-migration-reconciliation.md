# Production Migration Reconciliation for Muse Connector

Status: **gateway healthy on production HTTPS; merchant dashboard/privacy release and authenticated reviewer proof remain pending** (4 October 2026).

See [the current release status](muse-release-status-2026-10-04.md) for the latest
CodeRabbit override, runtime checks, and migration versions. Earlier status
statements below are historical deployment notes.

## Fresh production migration prepared

`20261003214512_connector_readonly_production.sql` was generated with the
Supabase CLI and combines the existing grant, audit, and owner-reissue SQL
with the owner-only inventory policy. It leaves the runtime role NOLOGIN.
Original proof migrations were preserved. The isolated reconciled deployment
bundle's dry run proposes exactly this migration, with no other changes.

The gateway runtime suite now applies the actual combined migration. All 142
connector tests pass across 21 files. A staff-inventory negative control fails
when the broad member policy is restored, and passes with the owner-only
policy. Biome and `git diff --check` are clean.

CodeRabbit completed current-diff reviews during the 4 October work. The latest
review reported no implementation defect and one trivial audit-retention item.
The item is deferred because Baci's approved retention period is not established;
choosing a retention period would drive scheduled irreversible deletion and
must match the public privacy notice. Do not describe this as a clean review gate.
Production is unchanged. The combined migration applied successfully on the
restored isolated proof branch. All four hosted SQL regression suites passed
(grants, audit, owner reissue, owner-only inventory). Final branch checks show
zero active grants and the gateway role NOLOGIN. This validates the migration
on the previously restored full schema; it does not establish fresh
parent/branch fingerprint parity after subsequent production migrations. A
fresh comparison of 34 connector dependency fingerprints matched all included
functions, policies, and table shapes except `products.discovery_metadata`, a
column outside gateway projections. This isolated comparison does not replace a
full production-schema restore proof.

The first hosted application failed because Supabase's migration role cannot
alter SUPERUSER attributes even to request NOSUPERUSER. The corrected migration
asserts that no elevated role attributes are present, then changes only
NOLOGIN. The failed attempt did not apply a migration; the corrected hosted
application and SQL regressions succeeded.

The recovery folder contains a deployment ZIP with a source/hash manifest.
It contains no runtime environment or CLI link metadata. Four unrelated local
migration files are excluded only from that isolated deployment bundle; their
repository files and production history were not changed.

## Correction after direct Supabase MCP inspection

Earlier statements below that the production ledger contains no SQL were
incorrect. Direct inspection found `statements text[]`, and all 41 missing
versions contain SQL. Their original statement arrays and generated SQL files
are recovered in `/Users/mac/Downloads/Baci Muse Migration Recovery`, with
SHA-256 hashes in `recovery-manifest.json`. No production history was changed.

Combining these recovered versions with current `origin/main` leaves zero
production versions without a local source. An isolated CLI dry run no longer
reports missing local versions. It now reports four unrelated older local
migrations, including two duplicate-version companions; none were applied.

A separate collision was confirmed: production version `20261001090000` is
`product_variant_recall`, while the staged connector uses that same version
for `connector_grants_r0`. The connector grant migration must receive a new
append-only production migration under a fresh version, preserving the staged
proof migration. Do not deploy using the colliding version.

The findings below describe the investigation before direct MCP recovery and
are retained as historical notes; their source-recovery blocker is superseded.

## Read-only findings

- The linked Supabase project is the production Baci project.
- `supabase db push --linked --dry-run` fails with
  `LegacyDbPushMissingLocalError` because production has migration versions
  that are absent from this checkout. The CLI suggests marking the missing
  versions reverted; that would rewrite production migration history and was
  not run.
- A fresh comparison found 1,426 production migration versions. The connector
  worktree contains 669 unique local versions. Fetched `origin/main` contains
  1,387 unique local versions and is therefore the better reconciliation base,
  but still lacks 41 production versions.
- The read-only declarative schema export completed in a temporary directory
  and reported `remoteHistoryUpdated: false`. It contained no connector
  grant, audit, resolver, rotation, or inventory policy objects. The temporary
  export was removed after inspection.
- Connector changes and existing staged work were left intact. No production
  migration, DNS, VPS, or Muse form changes were made.

## Production versions missing from `origin/main`

```text
20260623190041  20260624211416  20260625173604  20260626131520
20260629154903  20260630123511  20260701080400  20260701123945
20260706202930  20260706210329  20260707064146  20260708072653
20260708072825  20260708075932  20260708102643  20260708220832
20260713200830  20260727162504  20260803222954  20260805091000
20260812163138  20260812163339  20260812181800  20260812190459
20260812192502  20260813113927  20260823161144  20260831184101
20260831184123  20260831184124  20260831185821  20260831190107
20260907201145  20260914054729  20260921084129  20260921095843
20261002090046  20261002181204  20261003175517  20261003183737
20261003184149
```

Current `origin/main` also contains a checked-in production history replay
manifest. It maps the first 17 versions above to known migration bodies by
SHA-256 and labels each mapping `canonical`, `superseded-final-state`, or
`append-only-repair`. This is useful provenance, but it is not a substitute for
reconciling the rest of the currently linked production ledger: the manifest's
captured production ledger ends at `20260714225503`, while the live ledger now
contains 1,426 versions. Twenty-four missing versions therefore remain beyond
that documented replay set. `20260805091000` has two different candidate
filenames/bodies in fetched Git objects, and must not be selected by timestamp
alone. Reconcile the newer versions from their exact source commits, backup,
or deployment artifacts; do not treat the older replay receipt as current
production evidence.

For the remaining 24 IDs, the replay manifest has no source references. Three
IDs have candidate migration files somewhere in fetched Git objects
(`20260727162504`, `20260805091000`, and `20261002090046`), but no captured
production checksum binds those files to the applied rows. The other 21 IDs
have no migration bodies in fetched Git objects. Candidate presence alone does
not establish what was applied.

A read-only GitHub PR-file audit of 37 migration/deployment/database-related
merged PRs from the affected period found no PR file path with an exact prefix
for the remaining 24 production versions. The Supabase migration ledger
provides version IDs and timestamps, not the SQL bodies that ran.

## Safe continuation

1. Recover the exact SQL and filenames for all 41 versions. Do not create
   placeholder migrations and do not run `supabase migration repair` to make
   the CLI ignore the gap.
2. Compare each recovered migration with the production schema and current
   `origin/main`, preserving any intentional production-only changes.
3. Build a clean migration worktree based on current `origin/main`; port the
   connector change set there without disturbing this staged worktree.
4. Run migration-history comparison, connector SQL regressions, and
   `supabase db push --linked --dry-run` again. Apply only after the history is
   complete and the dry run lists only the reviewed connector migrations.
5. Keep DNS and the production gateway closed until the database and production
   scope gates pass.

The current connector migration timestamps precede some migration versions
already applied in production. Review their dependency order against the
reconciled history before deciding how to apply them; do not blindly renumber
an already-proven branch migration.

## 4 October review continuation

CodeRabbit completed two complete-diff reviews (7 then 5 issues). Valid items
were fixed: HTTP 400 for malformed JSON versus 413 for oversized bodies,
DELETE database failures mapped to UNKNOWN_OUTCOME, branch-loader failures
reported safely, and the UI split into a connection hook and components without
manual useCallback. A follow-up migration
`20261004030500_connector_grant_management_ownership.sql` restricts reissue to
the linked user as well as merchant owner and revocation to a live authorized
grant holder or merchant owner. Prior applied migration bodies remain unchanged.
Local disposable-Postgres regression proves staff cannot revoke another user's
grant and merchant owners cannot reissue another linked user's credentials.

The next review caught and corrected a post-create read-error regression introduced
while fixing DELETE; success still returns the one-time pair. Public static docs
and discovery no longer generate durable database audit rows; tool audits remain.
Expired active grants now display expired. Targeted checks pass; overall typecheck
retains only the 21 pre-existing Google Ads errors and tools-workers typecheck passes.
The server-wide extraction suggestion was deferred: the requested change was a
small edit to an existing large server, and the repository asks us to extract
only touched logic when it improves clarity. CodeRabbit's remaining trivial
retention note is not implemented because the approved retention period and
privacy disclosure are unresolved. No production rollout occurred. Both new
migrations applied successfully on the isolated branch; all four hosted SQL
regression suites passed after both were applied. The branch is paused.

## 4 October final state

The latest complete CodeRabbit pass reviewed the current diff before the
one-year purge and production deployment were added. It reported zero
critical/high issues and one trivial request for scheduled audit-row purge.
Local connector suite: 152 tests pass, plus the latest focused Muse UI suite
passes 12 tests. Tools-workers typecheck passes; app-wide TypeScript remains
limited to 21 unrelated pre-existing Google Ads errors.

## Production application on 4 October 2026

The owner had explicitly approved the read-only production rollout in ADR-003.
The four reviewed SQL files were applied sequentially through the Supabase
management migration tool to Baci (`aivqthbxdshhltbwipbr`):

- `connector_readonly_production` (provider ledger version `20261004071747`)
- `connector_grant_management_ownership` (provider ledger version `20261004071806`)
- `connector_retention_one_year` (provider ledger version `20261004071812`)
- `assert_connector_gateway_role_safety` (provider ledger version `20261004134356`)

Post-apply SQL confirmed the grant and audit tables, owner-only inventory
policy, and retention function. The retention regression ran inside an
explicit transaction and rolled back; it passed. The daily
`baci-connector-retention` cron entry exists once at `23 3 * * *`. The purge
function is not executable by `anon` or `authenticated`. `connector_gateway`
is still `NOLOGIN`, there are zero active grants, and no real merchant data was
used by this migration validation.

The previously documented CLI dry run covered the two-migration deployment
bundle before the retention migration existed. The four production changes
were applied directly and separately with the Supabase migration tool; a fresh
four-migration CLI dry run was not performed. The fourth migration only asserts
that the connector role has no elevated privileges. The original colliding
proof migration `20261001090000` was not applied.

DNS now directs `muse-api.usebaci.com` to the VPS, its Let's Encrypt
certificate is valid through 2 January 2027, and the HTTPS Nginx allowlist is
loaded. Public HTTPS checks confirm HTTP redirects to HTTPS, `/` and `/health`
return 404, and `/openapi.json` and `/docs` return 502 because the gateway
upstream is intentionally not running. No production database URL or runtime
credential has been installed on the VPS. The service remains closed pending
secure runtime provisioning and end-to-end production proof.
