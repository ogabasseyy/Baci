import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904081000_shipping_quote_booking_economics_projection.sql'
);

describe('shipping quote booking economics migration', () => {
  it('exposes economics only through a scoped SECURITY DEFINER projection', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_shipping_quote_booking_economics\(/i
    );
    expect(sql).toMatch(/'provider_cost', sq\.provider_cost/i);
    expect(sql).toMatch(/'platform_margin', sq\.platform_margin/i);
    expect(sql).toMatch(/'platform_margin_bps', sq\.platform_margin_bps/i);
    expect(sql).toMatch(/'pricing_version', sq\.pricing_version/i);
    expect(sql).toMatch(/'shipping_provider_cost', o\.shipping_provider_cost/i);
    expect(sql).toMatch(
      /'shipping_platform_margin', o\.shipping_platform_margin/i
    );
    expect(sql).toMatch(
      /'shipping_pricing_version', o\.shipping_pricing_version/i
    );
    expect(sql).toMatch(
      /'shipping_platform_retained_amount', o\.shipping_platform_retained_amount/i
    );
    expect(sql).toMatch(/shipping_quote_attestations/i);
    expect(sql).toMatch(/merchant\.user_id = \(SELECT auth\.uid\(\)\)/i);
    expect(sql).toMatch(/orders', 'fulfill'/i);
    expect(sql).toMatch(/orders', 'edit'/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_shipping_quote_booking_economics\(uuid, uuid, uuid\)[\s\S]*FROM PUBLIC, anon;/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_shipping_quote_booking_economics\(uuid, uuid, uuid\)[\s\S]*TO authenticated, service_role;/i
    );
    expect(sql).not.toMatch(/GRANT\s+EXECUTE[^;]*anon/i);
  });
});
