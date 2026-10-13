import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905112100_invalidate_quote_on_admin_transactional_edit.sql'
  ),
  'utf8'
);

describe('invalidate quote on admin transactional edit migration', () => {
  it('clears selected_quote_id after address, items, or shipping_fee edits', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.update_admin_order_with_transaction_discount_metadata('
    );
    expect(sql).toContain("'shipping_address'");
    expect(sql).toContain("'items'");
    expect(sql).toContain("'shipping_fee'");
    expect(sql).toContain('selected_quote_id = NULL');
    expect(sql).toContain('private.order_settled_gigl_retained_amount(');
    expect(sql).toContain("'reserved'");
    expect(sql).toContain("'provider_submitting'");
  });
});
