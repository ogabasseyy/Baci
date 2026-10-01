import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  process.cwd(),
  '../../supabase/migrations/20260811140100_repair_admin_reconciliation_pending_refunds.sql'
);

describe('pending refund reconciliation repair migration', () => {
  it('filters refund transactions that are still pending', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toContain('get_admin_reconciliation_v3_base');
    expect(sql).toContain("item->>'lane' = 'refund'");
    expect(sql).toContain("item->>'status' = 'pending'");
    expect(sql).toContain('jsonb_array_elements');
  });
});
