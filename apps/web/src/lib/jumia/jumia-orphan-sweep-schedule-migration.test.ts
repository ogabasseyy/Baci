import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Jumia orphan authorization sweep schedule migration', () => {
  it('schedules the service-role-only sweep inside Postgres', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        '../../supabase/migrations/20260825000500_schedule_jumia_orphan_authorization_sweep.sql'
      ),
      'utf8'
    );

    expect(sql).toContain("'jumia-orphan-authorization-sweep'");
    expect(sql).toContain(
      'SELECT public.purge_orphaned_jumia_authorizations()'
    );
    expect(sql).not.toContain('GRANT EXECUTE');
  });
});
