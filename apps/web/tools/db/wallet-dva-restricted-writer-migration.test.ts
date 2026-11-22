import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Statements only: comments may legitimately name the attributes they explain.
const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20261122064203_wallet_dva_restricted_writer.sql'
  ),
  'utf8'
).replace(/^\s*--.*$/gm, '');

const alterRoleStatements = [...migration.matchAll(/ALTER\s+ROLE[^;]*;/gi)].map(
  (match) => match[0]
);

// The deploy's Management API login is not a superuser. Postgres refuses any
// ALTER ROLE that names a superuser-class attribute for such a login, even
// when it would change nothing: `42501: permission denied to alter role`.
const SUPERUSER_CLASS_ATTRIBUTE =
  /\b(?:NO)?(?:SUPERUSER|BYPASSRLS|REPLICATION)\b/i;

describe('bugfix: wallet DVA writer migration aborted the production deploy', () => {
  it('does not name superuser-class attributes in any ALTER ROLE statement', () => {
    for (const statement of alterRoleStatements) {
      expect(statement).not.toMatch(SUPERUSER_CLASS_ATTRIBUTE);
    }
  });

  it('still converges the writer role to NOLOGIN', () => {
    expect(
      alterRoleStatements.some(
        (statement) =>
          /baci_wallet_dva_writer/.test(statement) &&
          /\bNOLOGIN\b/.test(statement)
      )
    ).toBe(true);
  });

  it('creates the role without elevated attributes', () => {
    const create = migration.match(
      /CREATE\s+ROLE\s+baci_wallet_dva_writer[^;]*;/i
    );
    expect(create?.[0]).toMatch(/\bNOLOGIN\b/);
    expect(create?.[0]).toMatch(/\bNOSUPERUSER\b/);
    expect(create?.[0]).toMatch(/\bNOBYPASSRLS\b/);
    expect(create?.[0]).toMatch(/\bNOCREATEROLE\b/);
    expect(create?.[0]).toMatch(/\bNOCREATEDB\b/);
    expect(create?.[0]).toMatch(/\bNOREPLICATION\b/);
  });

  it('fails closed through the catalog when the role has elevated attributes', () => {
    const guard = migration.match(
      /IF EXISTS \(\s*SELECT 1 FROM pg_catalog\.pg_roles[\s\S]*?RAISE EXCEPTION[^;]*;/i
    );
    expect(guard?.[0]).toMatch(/rolname = 'baci_wallet_dva_writer'/);
    for (const column of [
      'rolcanlogin',
      'rolsuper',
      'rolbypassrls',
      'rolcreaterole',
      'rolcreatedb',
      'rolreplication',
    ]) {
      expect(guard?.[0]).toContain(column);
    }
  });
});
