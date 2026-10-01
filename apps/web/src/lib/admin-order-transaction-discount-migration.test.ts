import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260827110002_atomic_admin_order_transaction_discount_cleanup.sql'
  ),
  'utf8'
);

describe('atomic admin order transaction discount cleanup migration', () => {
  it('clears metadata in the same transaction only for item or discount changes', () => {
    expect(migrationSql).toContain(
      'public.update_admin_order_with_transaction_discount_metadata'
    );
    expect(migrationSql).toContain(
      'v_result := public.update_admin_order(p_order_id, p_payload);'
    );
    expect(migrationSql).toContain(
      "ARRAY['items', 'subtotal', 'discount_amount']::text[]"
    );
    expect(migrationSql).toContain(
      "v_ad_tracking - 'baci_transaction_discount'"
    );
    expect(migrationSql).toContain(
      "NULLIF(\n        v_ad_tracking - 'baci_transaction_discount',\n        '{}'::jsonb\n      )"
    );
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'order_transaction_discount_cleanup_failed'"
    );
    expect(migrationSql).toContain(
      'REVOKE ALL ON FUNCTION public.update_admin_order(uuid, jsonb)\n  FROM PUBLIC, anon, authenticated;'
    );
    expect(migrationSql).not.toContain(
      "ARRAY['items', 'subtotal', 'shipping_fee', 'gift_wrapping_fee', 'tax_amount', 'discount_amount']::text[]"
    );
  });
});
