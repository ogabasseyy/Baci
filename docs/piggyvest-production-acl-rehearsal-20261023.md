# Production permissions manifest: isolated rehearsal

## Scope and provenance

Read-only metadata from project `aivqthbxdshhltbwipbr` was captured in one SQL statement on 23 October 2026: 66 roles, 71 membership edges, 29 non-catalog schemas, 1,196 relevant routines and ten relations. Six routines are the bank allowlist; 1,190 have PUBLIC execution. Integration and bank authority counts were both zero. No credentials, customer rows, balances, provider requests or general application routine bodies were exported.

Private local evidence directory: `/Users/mac/Documents/Codex/piggyvest-permissions-rehearsal-20261023/`. JSON files are mode 0600 under a mode 0700 directory.

- `production-acl-snapshot.json`: SHA-256 `f4362a5a724e433cf898133c3f63ae3393786c1f586288b6bc11cc0152bd2eb0`.
- `reviewed-local-manifest.json`: SHA-256 `2965c5cc305b6c847774ede95629d87737331db41546b58d53d7adde64457784`.
- `build_acl_clone.py`, `clone-bootstrap.sql`, `rehearse-acl.sql`, `recreated-public-negative.sql` and `verify-explicit-acls.sql` reproduce the metadata-only rehearsal locally.

## Clone contract

This is a **permissions-only clone**, not a restored application/schema or a production integration test. Source PostgreSQL is 17.6; the isolated local server was 17.11. It used only a private Unix socket with `listen_addresses=''` and was stopped after testing. Source LOGIN roles were deliberately made NOLOGIN; two new local test logins exercised actual SESSION_USER checks. No provider configuration or financial authority was installed.

Owners, object ACL grantors/grantees/options, schema ACLs, role privilege flags other than LOGIN, and membership ADMIN/INHERIT/SET options were reproduced. All 1,206 relevant object ACLs were compared exactly against their captured metadata before repair. Membership grantor provenance was not captured, so membership grant-dependency/revocation behavior is not proven.

Application and extension routine bodies/signatures were replaced by inert, uniquely mapped local stubs. Genuine aggregate and window stubs preserve their pg_proc kinds. The bank guard namespace, names, argument signatures and captured definition remain exact. Other bank allowlisted RPCs are inert stubs; their financial behavior is covered separately by existing SQL integration fixtures, not by this clone. Extension affiliation is recorded as metadata only; actual extension installation/upgrade behavior is not cloned.

## Manifest review and results

The mutation manifest contains exactly 1,200 targets: ten relations/sequences and 1,190 PUBLIC routines (1,163 normal functions, 25 aggregates, two window functions). It preserves PUBLIC-derived access for 33 ordinary roles disconnected from restricted roles. Built-in pg_* roles and restricted/membership-connected roles are not automatic preservation recipients; new roles require explicit provisioning. The candidate does not alter schema privileges, role membership, default privileges or the deployed safety predicate.

The production inventory exposed a missing routine-kind branch in the local candidate. A regression with real aggregate/window routines failed before the correction. The candidate now pins `expected_prokind` exactly and accepts f/a/w through FUNCTION grants, while unsupported kinds and kind drift fail closed. PostgreSQL's FUNCTION privilege syntax covers these kinds; procedures remain deliberately unsupported. [PostgreSQL 17 GRANT](https://www.postgresql.org/docs/17/sql-grant.html).

Rehearsal results:

- Both local restricted sessions failed the unchanged bank guard before repair and passed afterward.
- 40,161 individual PUBLIC-derived privilege comparisons across preservation consumers had zero regressions. This is not an assertion that every application operation was exercised.
- All 3,214 pre-existing explicit object ACL entries were retained, including grantor and grantability.
- Reintroduced PUBLIC aggregate, window and sequence privileges made the guard fail again; each negative probe was rolled back.
- Local SQL regression suite: four files, seven tests passed, including ACL/kind drift and forbidden-recipient rollback. Lint and typecheck passed.
- Independent source review found no new concrete repair defect; it identified the PUBLIC-derived comparison scope and missing membership-grantor provenance, both stated above. Review did not independently rerun the tests.

## Production deployment remains blocked

Supported-options investigation follow-up: `piggyvest-managed-permissions-supported-options-20261023.md` records Supabase's explicit pg_net platform constraint, the exact-ACL non-owner failure test, and passing separate-cluster PostgreSQL 17 tests. The local PUBLIC rewrite is not a production proposal. Isolation requires a reviewed financial ownership/handoff contract before implementation.

A separate read-only production check confirmed that `postgres` has neither EXECUTE WITH GRANT OPTION nor SET access to the owner for **203 PUBLIC routines**: 162 owned by `supabase_admin`, four by `supabase_auth_admin`, 19 by `supabase_storage_admin`, and 18 by `supabase_realtime_admin`. Superuser-led local success does not establish production ownership feasibility. There are also 982 extension-affiliated objects among the 1,206 cloned objects; extension ACL recreation remains an operational compatibility gate.

Do not remove the local-only guard, weaken bank_role_safe, assume a service-role API key grants ownership, or attempt to take ownership of managed objects. A supported managed-owner provisioning path or an independently reviewed isolation design must resolve this boundary before preparing any deployable artifact. The consumer manifest is a reviewed compatibility candidate, not production authorization.

No production ACL, role, integration, authority, payment switch, recording account or balance was changed. Live payments remain unactivated. The full repository suite was not rerun; its previously documented clean-checkout gate remains separate from these focused passing checks.
