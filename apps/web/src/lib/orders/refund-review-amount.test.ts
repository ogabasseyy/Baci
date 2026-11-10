import { describe, expect, it } from 'vitest';

import { reviewAmountText } from './refund-review-amount';

describe('reviewAmountText', () => {
  it('formats a single-currency total in that currency', () => {
    expect(
      reviewAmountText(
        [
          { amount: 100, currency: 'USD' },
          { amount: 50, currency: 'USD' },
        ],
        'NGN'
      )
    ).toContain('150');
    expect(reviewAmountText([{ amount: 100, currency: 'USD' }], 'NGN')).toMatch(
      /US\$|\$/
    );
  });

  it('omits the amount for mixed currencies', () => {
    expect(
      reviewAmountText(
        [
          { amount: 100, currency: 'USD' },
          { amount: 50, currency: 'NGN' },
        ],
        'NGN'
      )
    ).toBeNull();
  });

  it('falls back to the order currency and tolerates bad input', () => {
    expect(reviewAmountText([{ amount: 5 }], 'NGN')).toContain('5');
    expect(reviewAmountText(null, 'NGN')).toBeNull();
    expect(reviewAmountText([{ amount: 'x' }], 'NGN')).toBeNull();
  });
});
