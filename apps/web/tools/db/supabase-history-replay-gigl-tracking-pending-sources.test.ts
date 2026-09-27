import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIGL_TRACKING_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-gigl-tracking-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

describe('gigl tracking pending replay sources', () => {
  it('pins every tracking row to its checked-in migration bytes', async () => {
    const rows = GIGL_TRACKING_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const [sha256, filename, ...extra] = row.split(' ');
      expect(extra).toEqual([]);
      const migration = await readFile(
        path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
    }
  });

  it('covers the shipment tracking monitor cohort', () => {
    expect(GIGL_TRACKING_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260727220000_gigl_tracking_monitor_tables.sql'
    );
    expect(GIGL_TRACKING_PENDING_REPLAY_SOURCE_ROWS).toContain(
      '20260727220350_sync_gigl_tracking_order_status.sql'
    );
  });
});
