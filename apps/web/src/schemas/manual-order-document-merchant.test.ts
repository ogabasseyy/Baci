import { describe, expect, it } from 'vitest';
import { manualDocumentMerchantSchema } from './manual-order-document-merchant';

const baseMerchant = {
  id: 'merchant-1',
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  email_sender_name: null,
  logo_url: null,
  email: 'support@ogabassey.com',
  phone: null,
  support_email: null,
  support_phone: null,
  business_address: null,
  registered_address: null,
  cac_rc_number: null,
  tax_identification_number: null,
  legal_entity_name: null,
  vat_registration_status: null,
  vat_rate: null,
  bank_code: null,
  bank_account_number: null,
  bank_name: null,
  bank_account_name: null,
  brand_colors: null,
};

describe('manualDocumentMerchantSchema', () => {
  it('accepts a merchant row with nullable branding', () => {
    const parsed = manualDocumentMerchantSchema.parse(baseMerchant);

    expect(parsed.slug).toBe('ogabassey');
    expect(parsed.brand_colors).toBeNull();
  });

  it('normalizes legacy primary-only brand colors', () => {
    const parsed = manualDocumentMerchantSchema.parse({
      ...baseMerchant,
      brand_colors: { primary: '#ff0000' },
    });

    expect(parsed.brand_colors).toEqual({
      primary: '#ff0000',
      background: '#ff0000',
      accent: '#ff0000',
    });
  });

  it('requires merchant contact identity', () => {
    expect(() =>
      manualDocumentMerchantSchema.parse({ ...baseMerchant, email: undefined })
    ).toThrow();
  });

  it('falls back to default branding for malformed brand colors', () => {
    for (const brand_colors of ['{}', {}, [], 42]) {
      expect(
        manualDocumentMerchantSchema.parse({ ...baseMerchant, brand_colors })
          .brand_colors
      ).toBeNull();
    }
  });

  it('falls back for a malformed registered address', () => {
    for (const registered_address of ['12 Main St', [], 42]) {
      expect(
        manualDocumentMerchantSchema.parse({
          ...baseMerchant,
          registered_address,
        }).registered_address
      ).toBeNull();
    }
  });
});
