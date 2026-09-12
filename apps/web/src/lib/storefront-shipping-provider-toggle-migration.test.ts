import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903131000_expose_storefront_shipping_provider_toggle.sql`,
  'utf8'
);

describe('storefront shipping provider toggle projection', () => {
  it('returns the merchant provider allowlist through the checkout-safe RPC', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.get_storefront_shipping_rates('
    );
    expect(sql).toContain("'shipping_providers', COALESCE((");
    expect(sql).toContain('FROM public.merchant_feature_settings AS fs');
    expect(sql).toContain('WHERE fs.merchant_id = p_merchant_id');
    expect(sql).toContain("), '[]'::jsonb)");
  });

  it('preserves anonymous checkout access without exposing base-table grants', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.get_storefront_shipping_rates(uuid) FROM PUBLIC'
    );
    expect(sql).toContain('TO anon, authenticated, service_role');
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON/i);
  });
});
