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
const postgrestRepairMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260805113000_restore_gigl_tracking_postgrest_capability.sql'
  ),
  'utf8'
);
const requestScopeMigration = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20260805170000_isolate_gigl_tracking_postgrest_capability.sql'
  ),
  'utf8'
);

describe('GIGL tracking worker capability migration', () => {
  it('creates a non-login role that cannot bypass RLS', () => {
    expect(migration).toMatch(
      /CREATE ROLE gigl_tracking_worker NOLOGIN NOINHERIT NOSUPERUSER\s+NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/
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
    expect(postgrestRepairMigration).toMatch(
      /GRANT gigl_tracking_worker TO authenticator/
    );
    expect(postgrestRepairMigration).not.toMatch(
      /GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL)/
    );
  });

  it('confines the worker JWT to the five reviewed PostgREST RPC paths', () => {
    expect(requestScopeMigration).toMatch(
      /auth\.role\(\) IS DISTINCT FROM 'gigl_tracking_worker'/
    );
    expect(requestScopeMigration).toMatch(
      /request_method IS DISTINCT FROM 'POST'/
    );
    expect(requestScopeMigration).toMatch(/request_path IS NULL/);
    // PostgREST spells RPC routes in request.path without a leading slash
    // ("rpc/<function>"), so the five literals below are slashless by
    // design; a leading-slash spelling would never match and would fail
    // closed (deny) rather than open.
    expect(
      requestScopeMigration.match(/'rpc\/gigl_worker_[a-z_]+'/g)
    ).toHaveLength(5);
    expect(requestScopeMigration).toMatch(
      /ALTER ROLE authenticator\s+SET pgrst\.db_pre_request = 'public\.enforce_gigl_tracking_worker_request_scope'/
    );
    expect(requestScopeMigration).toMatch(
      /setting <> 'pgrst\.db_pre_request=public\.enforce_gigl_tracking_worker_request_scope'/
    );
    expect(requestScopeMigration).toMatch(/NOTIFY pgrst, 'reload config'/);
  });
});
