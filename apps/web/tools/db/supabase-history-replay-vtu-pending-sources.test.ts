import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VTU_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-vtu-pending-sources';

describe('VTU replay sources', () => {
  it('keeps every branch migration in the explicit pending registry input', () => {
    const migrations = VTU_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(migrations).toHaveLength(15);
    expect(migrations.at(-1)).toContain(
      '20261020061000_stamp_vtu_terminal_transition.sql'
    );
    const filenames = migrations.map((entry) => entry.split(' ')[1]);
    expect(filenames).toEqual([...filenames].sort());
    expect(new Set(filenames).size).toBe(15);

    for (const entry of migrations) {
      const [digest, filename] = entry.split(' ');
      const migration = readFileSync(
        resolve(process.cwd(), '../../supabase/migrations', filename),
        'utf8'
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(digest);
    }
  });
});
