import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260830150000_bind_quiz_voucher_order_item_ordinal.sql'
  ),
  'utf8'
);

describe('quiz voucher line ordinal migration', () => {
  it('binds duplicate voucher product lines to the persisted request ordinal', () => {
    expect(migrationSql).toMatch(
      /proname = 'create_storefront_order_with_quiz_voucher'[\s\S]*?pronargs = 23/i
    );
    expect(migrationSql).toContain("'__baci_line_ordinal'");
    expect(migrationSql).toContain('v_voucher_line_ordinal');
    expect(migrationSql).toMatch(
      /oi\.quiz_award_id IS NULL[\s\S]*?v_voucher_line_ordinal IS NULL OR oi\.line_id = v_voucher_line_ordinal/i
    );
  });
});
