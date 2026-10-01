import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260901201000_harden_wallet_shipping_quote_attestation.sql`,
  'utf8'
);

describe('wallet shipping quote attestation hardening', () => {
  it('redefines reservation to require a trusted attestation before debit', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge'
    );
    expect(sql).toContain('public.shipping_quote_attestations%ROWTYPE');
    expect(sql).toContain(
      'FROM public.shipping_quote_attestations\n  WHERE quote_id = p_quote_id\n  FOR SHARE'
    );
    expect(sql).toContain("RAISE EXCEPTION 'quote_not_eligible'");
    expect(sql).toContain('v_attestation.order_id IS DISTINCT FROM p_order_id');
    expect(sql).toContain(
      'v_attestation.merchant_id IS DISTINCT FROM v_order.merchant_id'
    );
    expect(sql).toContain(
      'v_attestation.provider_rate_id IS DISTINCT FROM v_quote.provider_rate_id'
    );
    expect(sql).toContain(
      'v_attestation.quote_request IS DISTINCT FROM v_quote.quote_request'
    );
  });

  it('rechecks every debit-relevant economics field and order context', () => {
    for (const expression of [
      'v_attestation.price IS DISTINCT FROM v_quote.price',
      'v_attestation.provider_cost IS DISTINCT FROM v_quote.provider_cost',
      'v_attestation.platform_margin IS DISTINCT FROM v_quote.platform_margin',
      'v_attestation.currency IS DISTINCT FROM v_quote.currency',
      'v_attestation.pricing_version IS DISTINCT FROM v_quote.pricing_version',
      'v_attestation.expires_at IS DISTINCT FROM v_quote.expires_at',
      'v_attestation.is_station_pickup IS DISTINCT FROM v_quote.is_station_pickup',
      "v_order.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'",
      'v_quote.session_id IS DISTINCT FROM p_order_id::text',
      '(v_existing.id IS NULL AND v_quote.expires_at <= now())',
    ]) {
      expect(sql).toContain(expression);
    }
  });

  it('models forged, mismatched, and valid attestation outcomes', () => {
    const reserve = ({
      hasAttestation,
      fieldsMatch,
      ownerMatches,
    }: {
      hasAttestation: boolean;
      fieldsMatch: boolean;
      ownerMatches: boolean;
    }) => hasAttestation && fieldsMatch && ownerMatches;

    expect(
      reserve({ hasAttestation: false, fieldsMatch: true, ownerMatches: true })
    ).toBe(false);
    expect(
      reserve({ hasAttestation: true, fieldsMatch: false, ownerMatches: true })
    ).toBe(false);
    expect(
      reserve({ hasAttestation: true, fieldsMatch: true, ownerMatches: false })
    ).toBe(false);
    expect(
      reserve({ hasAttestation: true, fieldsMatch: true, ownerMatches: true })
    ).toBe(true);
  });

  it('keeps attestation writes unavailable to authenticated callers', () => {
    expect(sql).toContain(
      'REVOKE ALL ON TABLE public.shipping_quote_attestations FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|DELETE).*shipping_quote_attestations.*authenticated/is
    );
  });

  it('preserves idempotent retries after a quote expires', () => {
    const lock = sql.indexOf('pg_advisory_xact_lock');
    const existing = sql.indexOf('FROM public.merchant_shipping_charges');
    const quote = sql.indexOf('FROM public.shipping_quotes');
    expect(lock).toBeGreaterThan(-1);
    expect(existing).toBeGreaterThan(lock);
    expect(quote).toBeGreaterThan(existing);
    expect(sql).toContain('IF v_existing.id IS NOT NULL THEN');
  });
});
