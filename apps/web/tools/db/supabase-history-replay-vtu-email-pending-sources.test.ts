import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VTU_EMAIL_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-vtu-email-pending-sources';

describe('VTU email sources', () => {
  it('keeps every branch migration in the explicit pending registry input', () => {
    const migrations = VTU_EMAIL_PENDING_REPLAY_SOURCE_ROWS.split('\n');
    expect(migrations).toHaveLength(5);
    expect(migrations.at(-1)).toContain(
      '20261016123000_finalize_vtu_customer_email_notification_success.sql'
    );
    const filenames = migrations.map((entry) => entry.split(' ')[1]);
    expect(filenames).toEqual([...filenames].sort());
    expect(new Set(filenames).size).toBe(5);

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
