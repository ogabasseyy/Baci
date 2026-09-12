import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903220200_revoke_order_gigl_economics_select.sql'
  ),
  'utf8'
);

describe('revoke order gigl economics select migration', () => {
  it('revokes authenticated reads of internal GIGL order economics columns', () => {
    expect(sql).toContain('REVOKE SELECT (');
    expect(sql).toContain('shipping_provider_cost');
    expect(sql).toContain('shipping_platform_margin');
    expect(sql).toContain('shipping_platform_retained_amount');
    expect(sql).toContain('shipping_pricing_version');
    expect(sql).toContain('ON TABLE public.orders FROM authenticated, anon');
  });
});
