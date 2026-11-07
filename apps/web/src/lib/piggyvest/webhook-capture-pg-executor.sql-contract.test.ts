import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  CAPTURE_DRAIN_STATEMENTS,
  CAPTURE_DRAIN_VERIFY_SESSION_SQL,
} from './webhook-capture-pg-executor';

/**
 * The executor's SQL and the database contract must not drift apart: the
 * session check runs verbatim in the catalog suite against PostgreSQL, and
 * every function a statement calls is exactly what the migration grants
 * the worker role.
 */
const ROOT = join(__dirname, '../../../../..');
const SUITE = readFileSync(
  join(
    ROOT,
    'supabase/tests/piggyvest_webhook_capture_drain_session_check.sql'
  ),
  'utf8'
);
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const migrationName = readdirSync(MIGRATIONS).find((name) =>
  name.endsWith('_piggyvest_webhook_capture_worker_role.sql')
);
const MIGRATION = readFileSync(join(MIGRATIONS, String(migrationName)), 'utf8');

const workerGrants = [
  ...MIGRATION.matchAll(
    /GRANT EXECUTE ON FUNCTION public\.([a-z_]+)\([^)]*\)\s+TO piggyvest_webhook_capture_worker;/g
  ),
].map((match) => match[1]);

describe('capture drain executor SQL contract', () => {
  it('runs the exact session check in the PostgreSQL catalog suite', () => {
    expect(SUITE).toContain(
      `$verify$${CAPTURE_DRAIN_VERIFY_SESSION_SQL}$verify$`
    );
  });

  it('calls only the functions the migration grants the worker', () => {
    const called = Object.values(CAPTURE_DRAIN_STATEMENTS).map(
      (text) => /public\.([a-z_]+)\(/.exec(text)?.[1]
    );
    expect(called.sort()).toEqual([...workerGrants].sort());
    expect(workerGrants).toEqual(
      expect.arrayContaining(['resolve_claimed_piggyvest_webhook_capture'])
    );
  });

  it('never grants the worker the shared resolve function', () => {
    expect(workerGrants).not.toContain('resolve_piggyvest_webhook_capture');
    expect(workerGrants).not.toContain('capture_piggyvest_webhook_delivery');
  });

  describe('session check object names', () => {
    const named = (name: string) =>
      [
        ...CAPTURE_DRAIN_VERIFY_SESSION_SQL.matchAll(
          /to_regprocedure\('public\.([a-z_]+)\(/g
        ),
      ].filter((match) => match[1] === name).length;

    it('requires, and excludes from the exposure count, exactly the functions the migration grants', () => {
      // Once in grants_usable and once in the unexpected_privileges exclusion.
      for (const name of workerGrants) expect(named(name)).toBe(2);
    });

    it.each([
      'capture_piggyvest_webhook_delivery',
      'resolve_piggyvest_webhook_capture',
      'piggyvest_webhook_captures_immutable_evidence',
    ])('denies the login %s and never counts it as an entry point', (name) => {
      expect(workerGrants).not.toContain(name);
      expect(named(name)).toBe(1);
    });

    it('still names the capture table it keeps the login away from', () => {
      expect(CAPTURE_DRAIN_VERIFY_SESSION_SQL).toContain(
        "to_regclass('public.piggyvest_webhook_captures')"
      );
    });
  });
});
