import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../supabase/migrations/20260828080000_persist_storefront_order_line_ordinals.sql'
  ),
  'utf8'
);

describe('storefront order line ordinal migration', () => {
  it('patches the private order RPC to persist request ordinals', () => {
    expect(migrationSql).toContain("'__baci_line_ordinal'");
    expect(migrationSql.toLowerCase()).toContain('line_ordinal integer');
    expect(migrationSql).toContain("!~ '^[0-9]+$'");
    expect(migrationSql).toContain("'duplicate_line_ordinal'");
    expect(migrationSql).toContain('GROUP BY line_ordinal');
    expect(migrationSql).toContain('t.line_ordinal');
    expect(migrationSql).toContain('ORDER BY t.line_ordinal NULLS LAST');
    expect(migrationSql).toContain(
      'storefront_order_item_line_ordinal_select_patch_failed'
    );
    expect(migrationSql).toContain(
      'invalid_variant_count\n  INTO v_invalid_item_count, v_invalid_quantity_count, v_invalid_variant_count'
    );
    expect(migrationSql).toContain(
      "IF v_invalid_variant_count > 0 THEN\n    RAISE EXCEPTION 'invalid_variant';\n  END IF;"
    );
    expect(migrationSql).toContain(
      "IF v_invalid_item_count > 0 THEN\n    RAISE EXCEPTION 'invalid_items';"
    );
  });
});
