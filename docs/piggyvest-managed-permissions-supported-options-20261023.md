# Managed permissions: supported options and tested boundary

## Decision

Do **not** promote the local PUBLIC-grant rewrite into a hosted Supabase deployment. The managed-owner limitation is not a missing customer grant. Supabase documents project-specific changes to pg_net grants as unsupported, and does not provide customer SUPERUSER access. The SQL Editor is not an elevation path. [pg_net ownership and supported options](https://supabase.com/kb/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect), [superuser restrictions](https://supabase.com/docs/guides/database/postgres/roles-superuser).

This directly settles the pg_net part of the blocker; it does not establish an identical support policy for every one of the 203 managed routines. The existing ownership/grant-option audit still prevents a customer-led rewrite of that complete set. No supported blanket regrant route for that set was identified. No support request was sent or special access attempted.

The local rewrite remains historical ACL-compatibility evidence only. Do not take managed ownership, grant managed-role membership, weaken bank_role_safe, replace worker credentials with service_role, or rely on a successful REVOKE command without checking its effect.

## Options considered

- Keep managed grants and put narrowly scoped services behind the Data API without direct database LOGIN roles. This is a documented platform option, but **not a drop-in fix**: current bank contracts require exact SESSION_USER/CURRENT_USER identity, memberships and an RPC-only privilege allowlist. A PostgREST/JWT adapter would need a separately reviewed authorization contract, not a skipped guard.
- Drop pg_net only if unused. A read-only production dependency check found three cron commands and six other routine bodies referencing net-related paths; the narrow webhook-trigger query returned zero, which is not proof that every webhook/dependency is absent. Do not drop the extension. Even removing it would leave other managed routine/relation privileges incompatible with the unchanged guard.
- Reuse the established isolated PostgreSQL pattern for a separately controlled financial capability boundary. **Recommended direction, as an architectural inference**, because it permits the unchanged strict grants/guards without modifying hosted Supabase services. This is not a Supabase-managed permission override. A separate cluster avoids shared cluster-wide roles; another database alone would require additional connection-denial proof.

No production cluster was created and no deployment design was silently selected or installed. Hosted Supabase remains the application's database and authentication platform.

## Tests performed

Private evidence remains under `/Users/mac/Documents/Codex/piggyvest-permissions-rehearsal-20261023/`.

1. Reused the production-derived metadata-only clone on PostgreSQL 17.11. `managed-owner-boundary.sql` temporarily restored PUBLIC grants on the 203 blocked routines and the synthetic net queue, attempted revocation as the captured nonsuperuser postgres SESSION_USER, and asserted exact ACL equality afterward. Warnings were emitted; the grants remained. All probes rolled back. This models normal PostgreSQL ownership, not all hosted Supabase extension hooks.
2. Created a separate local socket-only PostgreSQL 17.11 cluster, without pg_net, and ran the existing complete bank inbox fixture unchanged. Synthetic restricted intake and worker logins both passed bank_role_safe through separate direct sessions. Source-derived and finance clusters had different system identifiers; finance logins existed only in the finance cluster. Both clusters were stopped after testing.
3. Reran the bank permissions, bank inbox, paid-interest inbox and completion-notification SQL integration tests with PostgreSQL 17 binaries. **Four files, seven tests passed.**
4. Reused `tools/test/piggyvest-ledger-deferred-balance.test.py`: **11 tests passed**, including balanced restricted commits and rejection of unbalanced postings.
5. Lint and typecheck passed. Full monorepo testing was not repeated; the previously documented dirty-checkout gate remains separate.

The PostgreSQL 17 run first exposed an omitted fixture migration: deferred check_balance ran without its existing approved authority repair. The completion fixture setup is now extracted into a smaller file, and a local-only bootstrap adapter includes existing migration `20261003160000_piggyvest_ledger_deferred_balance_authority.sql` under its required synthetic postgres owner. It does not implement a new SECURITY DEFINER workaround, grant the worker table SELECT, or change an existing migration. Assertions confirm the worker cannot read postings or invoke the checker directly. PostgreSQL 18 passing results had not established this PostgreSQL 17 fixture coverage.

The bootstrap's synthetic postgres owner is SUPERUSER only inside disposable fixtures. That demonstrates checker/worker behavior, not managed Supabase executor compatibility. It is separate from the nonsuperuser postgres identity in the managed-owner boundary rehearsal. Independent source review found no concrete issues and noted this distinction; the reviewer did not rerun tests.

## Remaining architecture gates

The boundary/handoff design proposal is now recorded in `piggyvest-isolated-ledger-boundary-20261023.md`. It defines whole-aggregate ownership, lifecycle-fenced command admission, an atomic ordered outbox, a scoped Data API projection receiver and explicit recovery gates. These new contracts are not implemented or activated.

The isolated test is a capability-storage prototype, **not a replacement production financial backend or an end-to-end provider test**. Existing fixtures co-locate customer mappings, wallet balances, savings projections, notifications and ledger transactions. Moving only an inbox would lose that atomic boundary. Before implementation, specify which system owns financial state, authenticated scope resolution, durable handoff/outbox, idempotency, reconciliation, customer read models and recovery. Do not invent cross-database atomicity or add a service-role shortcut.

Unix-socket tests do not validate the runtime's required TLS/session checks, production credentials, backup/recovery, scheduler installation or live provider delivery. Those gates remain mandatory. Reuse existing store adapters, migrations and tests where they satisfy the reviewed boundary; avoid duplicating the savings implementation.

**Live payments remain disabled.** No production ACLs, roles, integration/authority rows, services, keys, recording accounts or balances changed.
