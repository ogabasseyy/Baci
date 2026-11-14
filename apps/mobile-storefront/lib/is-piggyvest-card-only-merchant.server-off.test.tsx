import { describe, expect, it } from '@jest/globals';
import { isPiggyvestCardOnlyMerchant } from './is-piggyvest-card-only-merchant';

const PILOT = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

// With the server keeping PiggyVest off, purchase top-ups keep today's sheet.
describe('isPiggyvestCardOnlyMerchant (server off)', () => {
  it('is false once the server rules PiggyVest out, even for the pilot', () => {
    expect(isPiggyvestCardOnlyMerchant(PILOT, false)).toBe(false);
  });

  it('is false for merchants without PiggyVest or without an id', () => {
    expect(isPiggyvestCardOnlyMerchant('merchant-1', null)).toBe(false);
    expect(isPiggyvestCardOnlyMerchant(undefined, null)).toBe(false);
  });

  it('is true for a PiggyVest merchant while the server verdict is unknown', () => {
    expect(isPiggyvestCardOnlyMerchant(PILOT, null)).toBe(true);
  });
});
