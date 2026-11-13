import { describe, expect, it } from '@jest/globals';
import { piggyvestWalletActivityPageSchema } from './piggyvest-wallet-activity';

describe('PiggyVest wallet activity page schema with the server keeping PiggyVest off', () => {
  it('rejects the not-ready error body instead of reading it as an empty list', () => {
    expect(
      piggyvestWalletActivityPageSchema.safeParse({
        error: 'Wallet activity is temporarily unavailable.',
        code: 'PIGGYVEST_NOT_READY',
      }).success
    ).toBe(false);
  });

  it('accepts an empty last page', () => {
    expect(
      piggyvestWalletActivityPageSchema.parse({ items: [], nextCursor: null })
    ).toEqual({ items: [], nextCursor: null });
  });
});
