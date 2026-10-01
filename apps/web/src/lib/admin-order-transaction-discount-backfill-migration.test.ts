import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828070000_backfill_historical_admin_discount_provenance.sql'
  ),
  'utf8'
);

describe('historical admin discount provenance backfill', () => {
  it('marks audited financial edits before legacy VAT inference', () => {
    expect(migrationSql).toContain('public.order_audit_events');
    expect(migrationSql).toContain(
      'private.transaction_discount_admin_edit_context'
    );
    expect(migrationSql).toContain('pg_catalog.txid_current()');
    expect(migrationSql).toContain(
      "ARRAY['items', 'subtotal', 'discount_amount']::text[]"
    );
    expect(migrationSql).toContain("'source', 'historical_audit'");
    expect(migrationSql).toContain(
      "orders.ad_tracking ? 'baci_transaction_discount'"
    );
    expect(migrationSql).toContain('COALESCE(orders.discount_amount, 0) > 0');
  });

  it('preserves historical order timestamps while adding provenance', () => {
    expect(migrationSql).toMatch(
      /CREATE TEMP TABLE historical_admin_discount_edits[\s\S]*?updated_at timestamptz/i
    );
    expect(migrationSql).toContain(
      'ALTER TABLE public.orders DISABLE TRIGGER "update_orders_updated_at"'
    );
    expect(migrationSql).toContain('FOR UPDATE OF orders');
    expect(migrationSql).toContain('updated_at = edits.updated_at');
    expect(migrationSql).toContain(
      'ALTER TABLE public.orders ENABLE TRIGGER "update_orders_updated_at"'
    );
  });
});
