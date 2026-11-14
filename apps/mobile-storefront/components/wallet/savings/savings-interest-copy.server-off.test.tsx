import { EARLY_CANCEL_INTEREST_NOTE } from './savings-interest-copy';

describe('savings interest copy with PiggyVest off', () => {
  it('uses the owner’s exact early-cancel wording', () => {
    expect(EARLY_CANCEL_INTEREST_NOTE).toBe(
      'Cancel early and lose your interest.'
    );
  });
});
