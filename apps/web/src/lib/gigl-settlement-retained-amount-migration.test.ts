import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260902092321_secure_gigl_shipping_settlement_retained_amount.sql'
  ),
  'utf8'
);
const capMigration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260902103100_cap_gigl_shipping_settlement_retention.sql'
  ),
  'utf8'
);

describe('GIGL settlement retained-amount migration', () => {
  it('recomputes retention from the selected quote, not caller metadata', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1('
    );
    expect(migration).toMatch(
      /o\.shipping_funding_source = 'customer_checkout'/
    );
    expect(migration).toMatch(/sq\.provider = 'GIGL'/);
    expect(migration).toMatch(
      /sq\.pricing_version = 'gigl_platform_margin_v1'/
    );
    expect(migration).toMatch(/p_platform_fee \+ v_retained_shipping_amount/);
    expect(migration).toMatch(/retained_shipping_amount/);
  });

  it('keeps the settlement wrapper service-role-only', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_merchant_settlement_gigl_v1\([\s\S]*?\) FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_merchant_settlement_gigl_v1\([\s\S]*?\) TO service_role/
    );
  });

  it('caps authoritative quote retention to the verified post-fee gross', () => {
    expect(capMigration).toMatch(/LEAST\s*\(/i);
    expect(capMigration).toMatch(/GREATEST\(v_quote_shipping_amount,\s*0\)/i);
    expect(capMigration).toMatch(/p_gross_amount/i);
    expect(capMigration).toMatch(/p_gateway_fee/i);
    expect(capMigration).toMatch(/p_platform_fee/i);
  });
});
