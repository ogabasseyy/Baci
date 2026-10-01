import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901200000_secure_admin_gigl_quote_attestation.sql'
  ),
  'utf8'
);

describe('Admin GIGL quote binding migration', () => {
  it('defines an owner-checked transactional RPC with narrow grants', () => {
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('m.user_id = auth.uid()');
    expect(sql).toContain("shipping_funding_source = 'merchant_wallet'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
    expect(sql).toContain('TO authenticated');
  });

  it('uses a service-role-only trusted writer', () => {
    expect(sql).toContain('persist_admin_gigl_quote');
    expect(sql).toContain('TO service_role');
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.persist_admin_gigl_quote\(jsonb, jsonb\) FROM PUBLIC, anon, authenticated/
    );
  });

  it('never grants authenticated attestation table writes', () => {
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.shipping_quote_attestations FROM PUBLIC, anon, authenticated'
    );
    expect(sql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON TABLE public\.shipping_quote_attestations\s+TO\s+authenticated/i
    );
  });

  it('locks order, quote, attestation, and wallet rows before binding', () => {
    expect(sql).toMatch(
      /FROM public\.orders WHERE id = p_order_id[^;]+FOR UPDATE/s
    );
    expect(sql).toMatch(
      /FROM public\.shipping_quotes WHERE id = p_quote_id FOR UPDATE/s
    );
    expect(sql).toMatch(
      /FROM public\.shipping_quote_attestations WHERE quote_id = p_quote_id FOR UPDATE/s
    );
    expect(sql).toMatch(
      /FROM public\.merchant_wallets w WHERE w\.merchant_id = p_merchant_id FOR UPDATE/s
    );
  });

  it('compares all mutable quote economics to the attestation snapshot', () => {
    for (const field of [
      'price',
      'provider_cost',
      'platform_margin',
      'currency',
      'pricing_version',
      'expires_at',
      'is_station_pickup',
    ]) {
      expect(sql).toContain(
        `v_attestation.${field} IS DISTINCT FROM v_quote.${field}`
      );
    }
  });

  it('compares provider rate identity and request snapshot', () => {
    expect(sql).toContain(
      'v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id'
    );
    expect(sql).toContain(
      'v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request'
    );
  });

  it('rejects post-attestation quote mutation', () => {
    expect(sql).toContain('prevent_attested_quote_mutation');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.shipping_quotes');
    expect(sql).toContain('attested_shipping_quote_immutable');
  });

  it('requires GIGL NGN door-delivery v1 quotes', () => {
    expect(sql).toContain("v_quote.provider IS DISTINCT FROM 'GIGL'");
    expect(sql).toContain("v_quote.currency IS DISTINCT FROM 'NGN'");
    expect(sql).toContain(
      "v_quote.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'"
    );
    expect(sql).toContain('v_quote.is_station_pickup');
  });
});
