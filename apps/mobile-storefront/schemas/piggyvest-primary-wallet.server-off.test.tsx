import { describe, expect, it } from '@jest/globals';
import { PiggyvestPrimaryWalletSchemas } from './piggyvest-primary-wallet';

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

describe('savings wallet setup schema with the server keeping PiggyVest off', () => {
  it('asks plainly for consent when the box is not ticked', () => {
    const parsed = PiggyvestPrimaryWalletSchemas.create.safeParse({
      merchantId,
      bvn: '12345678901',
      consent: false,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(
      'Tick the box to agree before continuing.'
    );
  });

  it('accepts an 11-digit BVN with consent', () => {
    expect(
      PiggyvestPrimaryWalletSchemas.create.safeParse({
        merchantId,
        bvn: '12345678901',
        consent: true,
      }).success
    ).toBe(true);
  });
});
