import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIGL_WALLET_SHIPPING_PENDING_SOURCES } from './supabase-history-replay-gigl-wallet-sources';

describe('GIGL wallet replay sources', () => {
  it('keeps every branch migration in the explicit pending registry input', () => {
    const migrations = GIGL_WALLET_SHIPPING_PENDING_SOURCES.split('\n');
    expect(migrations).toHaveLength(90);
    expect(migrations.at(-1)).toContain(
      '20260906120500_include_coordinates_in_stale_admin_gigl_bind_compare.sql'
    );
    const filenames = migrations.map((entry) => entry.split(' ')[1]);
    expect(filenames).toEqual([...filenames].sort());
    expect(new Set(filenames).size).toBe(90);

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
