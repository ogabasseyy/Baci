import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260902110000_prevent_unattested_wallet_funding_source.sql`,
  'utf8'
);

describe('GIGL wallet funding-source integrity migration', () => {
  it('guards direct order writes with a protected attestation or charge', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.enforce_gigl_wallet_funding_source()'
    );
    expect(sql).toContain(
      "NEW.shipping_funding_source IS DISTINCT FROM 'merchant_wallet'"
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'merchant_wallet_funding_requires_attested_quote'"
    );
    expect(sql).toContain('public.shipping_quote_attestations');
    expect(sql).toContain('public.merchant_shipping_charges');
    expect(sql).toContain("c.status IS DISTINCT FROM 'refunded'");
    expect(sql).toContain('sq.expires_at > now()');
    expect(sql).toContain('a.order_id = NEW.id');
    expect(sql).toContain('a.merchant_id = NEW.merchant_id');
  });

  it('binds the guard before both inserts and funding-source updates', () => {
    expect(sql).toMatch(
      /CREATE TRIGGER enforce_gigl_wallet_funding_source\s+BEFORE INSERT OR UPDATE OF selected_quote_id, shipping_funding_source/s
    );
    expect(sql).toContain('ON public.orders');
    expect(sql).toContain('private.enforce_gigl_wallet_funding_source()');
  });

  it('models the regression: an untrusted customer quote cannot become wallet-funded', () => {
    const canSetWalletFunding = ({
      hasAttestation,
      hasActiveCharge,
      quoteActive,
      selectedQuote,
    }: {
      hasAttestation: boolean;
      hasActiveCharge: boolean;
      quoteActive: boolean;
      selectedQuote: boolean;
    }) => selectedQuote && (hasActiveCharge || (hasAttestation && quoteActive));

    expect(
      canSetWalletFunding({
        hasAttestation: false,
        hasActiveCharge: false,
        quoteActive: true,
        selectedQuote: true,
      })
    ).toBe(false);
    expect(
      canSetWalletFunding({
        hasAttestation: true,
        hasActiveCharge: false,
        quoteActive: true,
        selectedQuote: true,
      })
    ).toBe(true);
    expect(
      canSetWalletFunding({
        hasAttestation: false,
        hasActiveCharge: true,
        quoteActive: false,
        selectedQuote: true,
      })
    ).toBe(true);
    expect(
      canSetWalletFunding({
        hasAttestation: true,
        hasActiveCharge: true,
        quoteActive: false,
        selectedQuote: false,
      })
    ).toBe(false);
    expect(
      canSetWalletFunding({
        hasAttestation: true,
        hasActiveCharge: false,
        quoteActive: false,
        selectedQuote: true,
      })
    ).toBe(false);
  });
});
