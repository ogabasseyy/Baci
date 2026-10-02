import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260805090300_add_least_privilege_gigl_tracking_worker.sql'
  ),
  'utf8'
);
const loginMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260805091000_enable_least_privilege_gigl_tracking_login.sql'
  ),
  'utf8'
);
const RESTORE_MIGRATION_PATH = join(
  process.cwd(),
  '../../supabase/migrations/20260805113000_restore_gigl_tracking_postgrest_capability.sql'
);
const ISOLATE_MIGRATION_PATH = join(
  process.cwd(),
  '../../supabase/migrations/20260805170000_isolate_gigl_tracking_postgrest_capability.sql'
);
const postgrestRepairMigration = readFileSync(RESTORE_MIGRATION_PATH, 'utf8');
const requestScopeMigration = readFileSync(ISOLATE_MIGRATION_PATH, 'utf8');

describe('GIGL tracking worker capability migration', () => {
  it('creates a non-login role that cannot bypass RLS', () => {
    expect(migration).toMatch(
      /CREATE ROLE gigl_tracking_worker NOLOGIN NOINHERIT NOSUPERUSER\s+NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/
    );
    // Membership lands atomically with the hook in the isolate migration,
    // never here: granting it at role creation would leave the token
    // usable without the hook if a later migration failed.
    expect(migration).not.toMatch(
      /GRANT gigl_tracking_worker TO authenticator/
    );
  });

  it('grants only the five tracking wrapper procedures to the worker role', () => {
    const grants = migration.match(
      /GRANT EXECUTE ON FUNCTION public\.gigl_worker_[\s\S]*?TO gigl_tracking_worker;/g
    );

    expect(grants).toHaveLength(5);
    expect(migration).not.toMatch(
      /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL).*TO gigl_tracking_worker/
    );
  });

  it('authenticates every wrapper before elevating the bounded call', () => {
    expect(
      migration.match(
        /IF auth\.role\(\) IS DISTINCT FROM 'gigl_tracking_worker'/g
      )
    ).toHaveLength(5);
    expect(
      migration.match(
        /set_config\('request\.jwt\.claim\.role', 'service_role', true\)/g
      )
    ).toHaveLength(5);
  });

  it('validates wrapper inputs before elevating to the service role', () => {
    const wrappers = migration.split(
      'CREATE OR REPLACE FUNCTION public.gigl_worker_'
    );

    expect(wrappers).toHaveLength(6);
    for (const body of wrappers.slice(1)) {
      const guardAt = body.indexOf('GIGL worker id is invalid');
      const elevateAt = body.indexOf(
        "set_config('request.jwt.claim.role', 'service_role', true)"
      );

      expect(guardAt).toBeGreaterThanOrEqual(0);
      expect(elevateAt).toBeGreaterThanOrEqual(0);
      expect(guardAt).toBeLessThan(elevateAt);
    }
    // Only the claim wrapper takes a limit; it mirrors the underlying
    // 1..100 bound so a future inner relaxation cannot widen authority.
    expect(
      migration.match(/GIGL worker claim limit must be between 1 and 100/g)
    ).toHaveLength(1);
    expect(
      migration.match(/char_length\(btrim\(p_worker_id\)\) > 128/g)
    ).toHaveLength(5);
  });

  it('records the temporary connection-limited login without embedding a password', () => {
    expect(loginMigration).toMatch(
      /REVOKE gigl_tracking_worker FROM authenticator/
    );
    expect(loginMigration).toMatch(
      /ALTER ROLE gigl_tracking_worker LOGIN CONNECTION LIMIT 2/
    );
    expect(loginMigration).not.toMatch(/ALTER ROLE[\s\S]*PASSWORD\s+'/i);
    expect(loginMigration).not.toMatch(
      /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)/
    );
  });

  it('removes direct login and restores only signed PostgREST role switching', () => {
    expect(postgrestRepairMigration).toMatch(
      /ALTER ROLE gigl_tracking_worker NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL/
    );
    // Membership lands in the isolate migration, never here: granting it
    // before the hook is active would leave the token usable without the
    // hook if a later migration failed.
    expect(postgrestRepairMigration).not.toMatch(
      /GRANT gigl_tracking_worker TO authenticator/
    );
    expect(postgrestRepairMigration).not.toMatch(
      /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)/
    );
  });

  it('confines the worker JWT to the five reviewed PostgREST RPC paths', () => {
    // The hook is installed and activated in the restore migration, a full
    // phase before membership is granted: PostgreSQL exposes membership at
    // commit while PostgREST reloads asynchronously, so same-transaction
    // activation would leave a post-commit bypass window.
    expect(postgrestRepairMigration).toMatch(
      /auth\.role\(\) IS DISTINCT FROM 'gigl_tracking_worker'/
    );
    expect(postgrestRepairMigration).toMatch(
      /request_method IS DISTINCT FROM 'POST'/
    );
    expect(postgrestRepairMigration).toMatch(/request_path IS NULL/);
    // PostgREST spells RPC routes in request.path without a leading slash
    // ("rpc/<function>"), so the five literals below are slashless by
    // design; a leading-slash spelling would never match and would fail
    // closed (deny) rather than open.
    expect(
      postgrestRepairMigration.match(/'rpc\/gigl_worker_[a-z_]+'/g)
    ).toHaveLength(5);
    expect(postgrestRepairMigration).toMatch(
      /ALTER ROLE authenticator\s+SET pgrst\.db_pre_request = 'public\.enforce_gigl_tracking_worker_request_scope'/
    );
    expect(postgrestRepairMigration).toMatch(
      /setting <> 'pgrst\.db_pre_request=public\.enforce_gigl_tracking_worker_request_scope'/
    );
    expect(postgrestRepairMigration).toMatch(/NOTIFY pgrst, 'reload config'/);
    expect(postgrestRepairMigration).toMatch(
      /PostgREST pre-request hook failed to install/
    );
  });

  it('grants authenticator membership only after the hook is active', () => {
    expect(requestScopeMigration).toMatch(
      /GRANT gigl_tracking_worker TO authenticator/
    );
    // The hook must not be (re)installed here: enforcement predates
    // usability, so activation stays in the earlier phase.
    expect(requestScopeMigration).not.toMatch(/pgrst\.db_pre_request/);
    expect(requestScopeMigration).not.toMatch(/CREATE OR REPLACE FUNCTION/);
    // Supabase applies migrations in filename order: the restore phase
    // (hook install) sorts before the isolate phase (membership grant).
    expect(RESTORE_MIGRATION_PATH < ISOLATE_MIGRATION_PATH).toBe(true);
  });

  it('lets every API role execute the pre-request hook', () => {
    // PostgREST invokes db_pre_request after User Impersonation, so the
    // hook runs as the request JWT role; revoking EXECUTE from normal
    // roles would fail every Data API request before the early return.
    expect(postgrestRepairMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.enforce_gigl_tracking_worker_request_scope\(\)\s+TO PUBLIC/
    );
    expect(requestScopeMigration).not.toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_gigl_tracking_worker_request_scope/
    );
  });
});
