import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903134000_fix_authenticated_gigl_quote_boundaries.sql`,
  'utf8'
);

describe('authenticated GIGL quote boundary fixes', () => {
  it('validates refreshed prices with kobo-ceil pricing', () => {
    expect(sql).toContain(
      'ceil((round(v_cost * 100) * 11000) / 10000.0) / 100.0'
    );
    expect(sql).not.toContain('ceil((round(v_cost * 100) * 1100) / 100000.0)');
  });

  it('exposes an authenticated Admin GIGL writer for initial quotes', () => {
    expect(sql).toContain('persist_authenticated_admin_gigl_quote');
    expect(sql).toContain(
      "check_staff_permission(\n       auth.uid(), v_merchant_id, 'orders', 'fulfill'"
    );
    expect(sql).toContain('TO authenticated');
    expect(sql).not.toContain('createAdminClient');
  });

  it('revokes authenticated writes to internal shipment economics', () => {
    expect(sql).toContain(
      'REVOKE INSERT (provider_cost, platform_margin)\n  ON TABLE public.shipments FROM authenticated;'
    );
    expect(sql).toContain(
      'REVOKE UPDATE (provider_cost, platform_margin)\n  ON TABLE public.shipments FROM authenticated;'
    );
    expect(sql).toContain(
      'REVOKE INSERT (provider_cost, platform_margin)\n  ON TABLE public.merchant_shipping_charges FROM authenticated;'
    );
    expect(sql).toContain(
      'REVOKE UPDATE (provider_cost, platform_margin)\n  ON TABLE public.merchant_shipping_charges FROM authenticated;'
    );
  });
});
