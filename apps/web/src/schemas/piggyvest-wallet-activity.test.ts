import { describe, expect, it } from 'vitest';
import {
  piggyvestWalletActivityQuerySchema,
  piggyvestWalletActivityRowSchema,
} from './piggyvest-wallet-activity';

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('piggyvestWalletActivityQuerySchema', () => {
  it('defaults the page size to 20', () => {
    expect(piggyvestWalletActivityQuerySchema.parse({ merchantId })).toEqual({
      merchantId,
      limit: 20,
    });
  });

  it('accepts the 1 and 50 page-size bounds and rejects outside them', () => {
    expect(
      piggyvestWalletActivityQuerySchema.safeParse({ merchantId, limit: '1' })
        .success
    ).toBe(true);
    expect(
      piggyvestWalletActivityQuerySchema.safeParse({ merchantId, limit: '50' })
        .success
    ).toBe(true);
    for (const limit of ['0', '51', '2.5'])
      expect(
        piggyvestWalletActivityQuerySchema.safeParse({ merchantId, limit })
          .success
      ).toBe(false);
  });

  it('rejects unknown keys, a bad merchant and a non-url-safe cursor', () => {
    for (const query of [
      { merchantId, extra: '1' },
      { merchantId: 'nope' },
      { merchantId, cursor: 'a+b/c=' },
    ])
      expect(piggyvestWalletActivityQuerySchema.safeParse(query).success).toBe(
        false
      );
  });
});

describe('piggyvestWalletActivityRowSchema', () => {
  const row = {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'bank_transfer',
    direction: 'in',
    amount_kobo: 5000000,
    fee_kobo: 0,
    label: 'Money added',
    status: 'completed',
    occurred_at: '2026-11-13T10:00:00+00:00',
  };

  it('accepts a customer-facing row', () => {
    expect(piggyvestWalletActivityRowSchema.parse(row)).toEqual(row);
  });

  it('rejects extra (internal) fields, unknown kinds and non-positive amounts', () => {
    for (const bad of [
      { ...row, reference: 'pvb-save-1' },
      { ...row, kind: 'withdrawal' },
      { ...row, amount_kobo: 0 },
      { ...row, fee_kobo: -1 },
    ])
      expect(piggyvestWalletActivityRowSchema.safeParse(bad).success).toBe(
        false
      );
  });
});
