import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationPath =
  '../../../../../supabase/migrations/20260831110000_jumia_order_marketplace_scope.sql';

describe('Jumia order marketplace scope migration', () => {
  it('adds and backfills a required marketplace discriminator', async () => {
    const sql = await readFile(new URL(migrationPath, import.meta.url), 'utf8');

    expect(sql).toMatch(
      /ALTER TABLE public\.jumia_orders[\s\S]*ADD COLUMN IF NOT EXISTS marketplace_key text/i
    );
    expect(sql).toMatch(
      /UPDATE public\.jumia_orders[\s\S]*SET marketplace_key = matches\.marketplace_key[\s\S]*FROM unambiguous_matches/i
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.jumia_orders[\s\S]*ALTER COLUMN marketplace_key SET DEFAULT 'default'[\s\S]*ALTER COLUMN marketplace_key SET NOT NULL/i
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_jumia_orders_marketplace_scope[\s\S]*merchant_id, jumia_shop_id, marketplace_key/i
    );
  });
});
