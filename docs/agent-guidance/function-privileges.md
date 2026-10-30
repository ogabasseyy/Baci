# Function privileges (RPCs and SECURITY DEFINER)

Migration `20261030233000_harden_public_definer_function_privileges.sql`
changed the default privileges for functions created by the migration owner
(`postgres`). New functions are **no longer executable** by `PUBLIC`, `anon` or
`authenticated`. `service_role` and `postgres` keep their default grants.

## Why

Supabase's default privileges grant `EXECUTE` on every new `public` function to
`anon`, `authenticated` and `service_role`, and PostgreSQL grants it to `PUBLIC`.
A migration that drops and re-creates a function and only runs
`REVOKE ... FROM PUBLIC` therefore leaves the direct `anon` and `authenticated`
grants in place, so the function is callable at `/rest/v1/rpc/<name>` with the
public anon key. `CREATE OR REPLACE` keeps the existing grants; `DROP` plus
`CREATE` resets them to the defaults.

## Rules for new functions

- Every function a browser, mobile app, RLS policy or PostgREST client calls
  needs an explicit grant in the migration that creates it:

  ```sql
  REVOKE ALL ON FUNCTION public.my_rpc(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.my_rpc(uuid) TO authenticated, service_role;
  ```

  Grant `anon` only when an unauthenticated caller really needs it, and verify
  the function's own token, ownership or `auth.uid()` checks first.
- Re-run the grants after any `DROP FUNCTION` plus `CREATE FUNCTION`, including a
  change of argument types.
- Trigger functions do not need `EXECUTE` to fire.
- Helpers in other schemas (`private.*`) and functions used inside policies or
  column defaults are evaluated as the calling role and need an explicit grant
  too. The same applies to extension functions created after the migration.
- SQL tests that create helper functions (including `pg_temp` assertions) and
  call them after `SET ROLE` must grant `EXECUTE` to that role.
- `supabase_admin` default privileges are not changed. It is a managed role that
  migrations never create objects as.

## CI guard

`supabase/tests/public_definer_function_exposure.sql` runs in the history-replay
step. It proves a new function is not executable by `anon`, `authenticated` or
`PUBLIC`, and fails when a public `SECURITY DEFINER` function that `anon` can
execute (or that has a `PUBLIC` grant) is missing from its allowlist. Fix the
grants first. Add an allowlist row, with a reason, only when anonymous callers
genuinely need the function. Rows marked `FOLLOW-UP` or `PENDING` are tracked
exceptions, not precedents.
