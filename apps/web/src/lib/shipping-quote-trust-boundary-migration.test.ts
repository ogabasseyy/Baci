import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903135000_attest_shipping_quote_writes_and_shipment_grants.sql`,
  'utf8'
);

describe('shipping quote trust boundary migration', () => {
  it('requires a domain-separated server proof for both authenticated writers', () => {
    expect(sql).toContain('private.verify_shipping_quote_route_proof');
    expect(sql).toContain('baci:shipping-quote-rpc:v1');
    expect(sql).toContain("p_proof->>'issued_at' IS NULL");
    expect(sql).toContain('v_issued_at IS NULL');
    expect(sql).toContain('IS DISTINCT FROM true');
    expect(sql).toContain('COALESCE(');
    expect(sql).toContain("v_signature !~ '^[0-9a-f]{64}$'");
    expect(sql).toContain(
      "v_payload := (p_route_proof->>'payload_text')::jsonb"
    );
    expect(sql).toContain('IF v_payload IS DISTINCT FROM');
    expect(sql).toContain('vault.decrypted_secrets');
    expect(sql).toContain("USING 'service_role_key'");
    expect(sql).toContain(
      'REVOKE SELECT ON TABLE public.shipping_quotes FROM authenticated;'
    );
    expect(sql).toContain(
      'REVOKE INSERT, UPDATE ON TABLE public.shipping_quotes FROM authenticated;'
    );
    const quoteSelectGrant = sql.match(
      /GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.shipping_quotes TO authenticated;/i
    )?.[1];
    expect(quoteSelectGrant).toBeDefined();
    expect(quoteSelectGrant).not.toMatch(
      /provider_cost|platform_margin|platform_margin_bps|pricing_version|provider_metadata/
    );
    expect(sql).toContain(
      'persist_authenticated_admin_gigl_quote(jsonb, jsonb, jsonb)'
    );
    expect(sql).toContain(
      'persist_refreshed_order_shipping_quote(uuid, jsonb, jsonb)'
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.persist_authenticated_admin_gigl_quote\(jsonb, jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated;/i
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.persist_refreshed_order_shipping_quote\(uuid, jsonb\)[\s\S]*?FROM PUBLIC, anon, authenticated;/i
    );
  });

  it('removes additive shipment table writes and regrants a non-economic column list', () => {
    expect(sql).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.shipments FROM authenticated;'
    );
    const insertGrant = sql.match(
      /GRANT INSERT \(([\s\S]*?)\) ON TABLE public\.shipments TO authenticated;/i
    )?.[1];
    expect(insertGrant).toBeDefined();
    expect(insertGrant).not.toMatch(/provider_cost|platform_margin/);
    expect(sql).toContain('stamp_gigl_shipment_economics');
    expect(sql).toContain("p_quote->>'provider' IS DISTINCT FROM 'TOPSHIP'");
    expect(sql).toMatch(/orders', 'fulfill/);
    expect(sql).toMatch(/orders', 'edit/);
  });
});
