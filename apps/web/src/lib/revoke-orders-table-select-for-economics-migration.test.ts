import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903220400_revoke_orders_table_select_for_economics.sql`,
  'utf8'
);

describe('revoke orders table select for economics migration', () => {
  it('revokes table-level SELECT then grants a safe column projection', () => {
    expect(sql).toContain(
      "EXECUTE 'REVOKE SELECT ON TABLE public.orders FROM authenticated, anon'"
    );
    expect(sql).toContain(
      "'GRANT SELECT (%s) ON TABLE public.orders TO authenticated, anon'"
    );
    expect(sql).toContain("'shipping_provider_cost'");
    expect(sql).toContain("'shipping_platform_margin'");
    expect(sql).toContain("'shipping_platform_retained_amount'");
    expect(sql).toContain("'shipping_pricing_version'");
  });
});
