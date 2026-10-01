import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('refreshed quote persistence migrations', () => {
  it('locks checkout refresh writes to service_role', () => {
    const sql = readFileSync(
      `${process.cwd()}/../../supabase/migrations/20260903129000_service_role_refreshed_merchant_shipping_quote.sql`,
      'utf8'
    );
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.persist_refreshed_merchant_shipping_quote('
    );
    expect(sql).toContain("auth.role()), '') <> 'service_role'");
    expect(sql).toContain('TO service_role');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).not.toContain('merchant.user_id = auth.uid()');
  });

  it('provides an order-scoped authenticated refresh that binds economics server-side', () => {
    const orderSql = readFileSync(
      `${process.cwd()}/../../supabase/migrations/20260903130500_authenticated_order_quote_refresh.sql`,
      'utf8'
    );
    expect(orderSql).toContain('persist_refreshed_order_shipping_quote');
    expect(orderSql).toContain(
      "check_staff_permission(\n    auth.uid(), v_merchant_id, 'orders', 'fulfill'"
    );
    expect(orderSql).toContain(
      "p_quote->>'pricing_version' <> 'gigl_platform_margin_v1'"
    );
    expect(orderSql).toContain(
      'INSERT INTO public.shipping_quote_attestations'
    );
    expect(orderSql).toContain('provider_metadata, expires_at, quote_request');
    expect(orderSql).toContain('NULL, v_expires, v_request');
    expect(orderSql).toContain('shipping_provider_cost = v_cost');
    expect(orderSql).toContain('TO authenticated');
  });
});
