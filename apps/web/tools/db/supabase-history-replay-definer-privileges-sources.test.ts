import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_DEFINER_PRIVILEGES_PENDING_SOURCES } from './expected-definer-privileges-pending-sources.test-support';
import { DEFINER_PRIVILEGES_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-definer-privileges-sources';

const MIGRATIONS = resolve(
  import.meta.dirname,
  '../../../../supabase/migrations'
);

describe('definer privilege replay sources', () => {
  it('binds the migration bytes to the pending registry row and expected entry', () => {
    const rows = DEFINER_PRIVILEGES_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(rows).toHaveLength(1);
    const [digest, filename] = rows[0].split(' ');
    expect(filename).toBe(
      '20261030233000_harden_public_definer_function_privileges.sql'
    );

    const bytes = readFileSync(resolve(MIGRATIONS, filename));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    expect(EXPECTED_DEFINER_PRIVILEGES_PENDING_SOURCES).toEqual([
      {
        repositoryPath: `supabase/migrations/${filename}`,
        sha256: digest,
      },
    ]);
  });
});
