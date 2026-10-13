import { describe, expect, it } from 'vitest';
import { getRedemptionInstructions } from './loyalty-redemption-instructions';

describe('getRedemptionInstructions', () => {
  it('renders percentage discounts without merchant currency', () => {
    expect(
      getRedemptionInstructions(
        {
          reward_type: 'discount',
          discount_type: 'percentage',
          discount_value: 10,
        },
        null
      )
    ).toBe('Apply this code at checkout to receive 10% off your order.');
  });

  it('renders fixed discounts in the merchant payout currency', () => {
    expect(
      getRedemptionInstructions(
        {
          reward_type: 'discount',
          discount_type: 'fixed',
          discount_value: 2000,
        },
        { country: 'IN', payout_currency: 'INR' }
      )
    ).toBe('Apply this code at checkout to receive ₹2,000 off your order.');
  });

  it('stays currency-neutral when the merchant lookup failed', () => {
    const copy = getRedemptionInstructions(
      { reward_type: 'discount', discount_type: 'fixed', discount_value: 2000 },
      null
    );

    expect(copy).toBe(
      'Apply this code at checkout to receive a fixed-amount discount off your order.'
    );
    expect(copy).not.toMatch(/₦|₹|\$/);
  });

  it('falls back to NGN only when the row is cleanly absent', () => {
    expect(
      getRedemptionInstructions(
        {
          reward_type: 'discount',
          discount_type: 'fixed',
          discount_value: 2000,
        },
        {}
      )
    ).toBe('Apply this code at checkout to receive ₦2,000 off your order.');
  });

  it('sends valueless discounts to manual fulfillment', () => {
    expect(
      getRedemptionInstructions(
        { reward_type: 'discount', discount_type: 'fixed', discount_value: 0 },
        { country: 'NG', payout_currency: 'NGN' }
      )
    ).toBe(
      'Present this code to receive your discount. Contact the store for details.'
    );
  });

  it('confirms store credit without a code', () => {
    expect(
      getRedemptionInstructions({ reward_type: 'store_credit' }, null)
    ).toBe(
      'The credit has been added to your store balance. Enable Wallet Credit at checkout to apply it to your order.'
    );
  });
});
