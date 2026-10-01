import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828010001_preserve_admin_discount_provenance.sql'
  ),
  'utf8'
);

describe('admin discount provenance migration', () => {
  it('wraps the cleanup function and records an admin-edit marker for financial changes', () => {
    expect(migrationSql).toContain(
      'RENAME TO update_admin_order_with_transaction_discount_metadata_v1'
    );
    expect(migrationSql).toContain(
      "ARRAY['items', 'subtotal', 'discount_amount']::text[]"
    );
    expect(migrationSql).toContain(
      "jsonb_build_object('status', 'admin_edit', 'version', 4)"
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.update_admin_order_with_transaction_discount_metadata(uuid, jsonb)'
    );
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'order_transaction_discount_provenance_failed'"
    );
  });
});
