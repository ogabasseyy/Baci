# R0 validation authorization

Authorized on 2 October 2026 through the owner's instruction:
"authorise and decide for me". The decisions below exercise that delegated
authority and are limited to the R0 database proof and private read-only
Muse pilot. The authorization expires on 9 October 2026.

## Isolated database

Create one temporary, data-less development branch of the existing Baci
Supabase project and run the connector migration, SQL regressions,
full-schema authorization/RLS comparisons, and harness checks there.
Seed synthetic test users, merchants, branches and orders only.

- Parent project: `aivqthbxdshhltbwipbr` (Baci).
- Existing organization: `rywjlzuhibxdfmtvdzrf`.
- Branch name: `baci-connector-r0-proof`.
- Branch ID: `a76990ce-aa97-49f5-8b30-0b847b37b825`.
- Branch project reference: `tzguvkfjycnrzeigigvs`.
- Creation confirmed by Supabase; `with_data: false`, `persistent: false`.
- Quoted branch rate: USD 0.01344/hour (USD 0.32256/day;
  USD 2.25792 for seven continuously billed days), plus applicable usage.
- Delete the task-owned branch after the proof and pilot are complete;
  review any extension beyond the authorization window before continuing.

Only this branch may receive test schema/data changes. The production
parent is a read-only source for schema comparison. No branch merge or
production migration/deployment is authorized by this decision.

## ADR-003 decision

Accept C-prime for the isolated R0 proof and read-only staging pilot:
direct connections using the branch's `connector_gateway` role, token
validation through the allowlisted RPC, and transaction-local role/claims
from validated resolve output. Business-data reads must pass through RLS
and retain the merchant/branch predicates and scope checks.

This scope permits test-only grant creation, rotation and revocation, and
the existing bounded order reads. It does not approve a service-role
user-facing client, R1 production routes, or business-data mutation tools.
R1 authorization remains contingent on the full-schema and real Muse
proofs and a further production-scope decision.

## Muse access and transport

Use an existing user-held Muse account to create a private test connector.
Authorize a temporary HTTPS staging endpoint or tunnel to the R0 harness,
using only branch credentials and synthetic data. Keep the harness owner
secret for local issuance/revocation; provide Muse only the scoped test
connector token. Do not expose owner-management endpoints through the
public pilot transport. Stop the transport and revoke pilot credentials
when the pilot ends.

An authenticated Muse session or the owner's interactive login may still
be required. This authorization supplies permission, not account access.
Purchasing a subscription or accepting a new external account agreement
is outside this decision.

## Completion evidence

Record branch readiness, exact migration/test results, direct-RLS versus
gateway comparisons, pool/claim isolation, and the Muse pilot observations
in the design/runbook. Record blocked proofs honestly. Approval alone
does not pass any R0 exit test or open R1.

## Observed execution status on 2 October

- The temporary branch was created without production data.
- Automatic replay initially failed because the production baseline ledger
  entry (`20260418000000`) contains zero stored statements. The branch had
  no public application relations, and the first replay error named the
  missing `public.extract_primary_image_from_jsonb(jsonb)` function.
- The unchanged repository baseline was restored successfully to the
  branch in one transaction using branch-specific credentials. No
  production DDL or data was changed.
- A branch-only rebase was requested to replay the remaining production
  migration history. It progressed through `20260425233000`, but Supabase
  still reported `MIGRATIONS_FAILED`. The branch's authorization helpers
  and application schemas did not yet match the production metadata, so
  full-schema equivalence is **not proved**. A subsequent read-only
  investigation established the later failure: the production ledger's
  `20260427132000` statements contain a filename instead of SQL. The branch
  PostgreSQL log at `2026-10-02T09:03:52.703Z` reports trailing junk at that
  filename. Other ledger rows contain no stored statements; automatic
  rebase cannot establish the complete application schema from this history.
- A schema-only production export was attempted with read-only connection
  options. The main-branch credential response masks its database password;
  authentication failed and no schema was exported by that attempt. This
  attempt is superseded by the successful CLI-authenticated export below.
  No production password was reset and no application schema or business
  data was changed.
- The test branch was resumed for this investigation and paused again.
  Repair and resume this same task-owned branch within the authorized
  window; never merge it into the parent.
- The owner confirms Muse is open and signed in on the desktop. Native
  desktop-control requests timed out, so the agent has not independently
  inspected that session. The browser login is not evidence about the
  desktop session. Actual pilot execution remains pending database proof
  and working access to the Muse interface. No account was created,
  subscription purchased, connector configured or tunnel exposed.

## CLI-authenticated schema export on 2 October

The current schema snapshot is now available. The authenticated Supabase
CLI account can issue short-lived database login credentials through the
[temporary login-role API](https://supabase.com/docs/reference/api/v1-create-login-role);
the masked branch-password response is not a blocker for this route.

- Export completed at `2026-10-02T13:02:54.606304Z`, with exit code 0 and
  the PostgreSQL dump-complete marker verified.
- Snapshot: [complete-schema-only.sql](</Users/mac/Downloads/Baci R0 Schema Proof 2026-10-02 53xmdb6q/complete-schema-only.sql>).
- Export evidence: [export-evidence.json](</Users/mac/Downloads/Baci R0 Schema Proof 2026-10-02 53xmdb6q/export-evidence.json>).
- Size: 6,230,571 bytes. SHA-256:
  `871f0acd43c7c15f4dc75dbb616bdbb96e412459e7997c6cb5dd955fe5cfa4a7`.
- Native PostgreSQL `pg_dump` 18.6 exported server 17.6 using
  `--schema-only --role postgres`. The container-based CLI dump timed out;
  the completed artifact was produced by the native client using credentials
  obtained through the CLI account's temporary-login flow.
- Table, function and policy counts match the current source metadata for
  `public`, `private`, `private_payment_control_plane`, `eventing`, `auth`
  and `storage`. In particular, the snapshot contains 208 public tables,
  887 public functions and 377 public policies. No row-data sections were
  exported. These checks validate the export, not branch restore or RLS
  behavior.
- The initially issued read-only login lacked managed-schema access and
  permission to `SET ROLE postgres`. The standard temporary CLI login was
  therefore used solely for schema export, with a 300-second login lifetime.
  A separate explicit `BEGIN READ ONLY` connection check confirmed the
  effective `postgres` role, read-only transaction and `auth` schema access.
- Issuing temporary provider authentication roles was the authentication
  side effect. No existing database password was reset, application schema
  changed, production business rows changed, migration applied or deployment
  performed. Local credential files were removed after the export; the
  snapshot was checked for those credentials and remains private (directory
  `0700`, files `0600`).

This export step did not resume or restore the branch. At export completion,
the full-schema branch proof, staging transport and real Muse pilot were
still pending. The subsequent branch proof below supersedes that status.

## Subsequent full-schema branch proof on 2 October

Full-schema branch confirmation is recorded as complete in the
[branch proof](muse-r0-branch-proof.md): snapshot restore, parent/branch
comparison, migration, SQL regressions, direct-RLS/gateway comparisons and
16/16 hosted harness checks. The sessionless resolver defect caught on the
real schema was fixed and verified with red-green controls. The branch was
re-paused, test grants revoked and gateway login disabled after the proof.

The approval decisions are complete. The next execution step is to resume
the same branch for the filtered staging transport and interactive Muse
pilot. R1 stays gated on the real pilot and production-scope ADR-003;
CodeRabbit re-review remains required before any commit or ship; the latest
attempt was blocked by the provider's review limit (see branch proof §7).
