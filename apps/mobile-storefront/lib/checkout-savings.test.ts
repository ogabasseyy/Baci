import type { SavingsGoal } from '@/lib/customer-savings';
import {
  getEligibleCheckoutSavingsGoal,
  goalMatchesCartItem,
  isRedeemableSavingsStatus,
} from './checkout-savings';

const baseGoal = {
  breakFeePercent: 3,
  contributionAmount: 20000,
  contributionFrequency: 'daily',
  currentAmount: 150000,
  id: 'goal-1',
  maturityDate: '2026-06-20',
  productId: 'product-1',
  sourceMode: 'manual',
  startDate: '2026-05-21',
  status: 'active',
  targetAmount: 470000,
  title: 'iPhone savings',
  variantId: null,
} satisfies SavingsGoal;

describe('getEligibleCheckoutSavingsGoal', () => {
  it('matches cart items by product and optional goal variant', () => {
    expect(
      goalMatchesCartItem(baseGoal, {
        product_id: 'product-1',
        variant_id: 'variant-1',
      })
    ).toBe(false);
    expect(
      goalMatchesCartItem(baseGoal, {
        product_id: 'product-1',
        variant_id: null,
      })
    ).toBe(true);
    expect(
      goalMatchesCartItem(baseGoal, {
        product_id: 'product-2',
        variant_id: null,
      })
    ).toBe(false);
    expect(
      goalMatchesCartItem(
        { ...baseGoal, variantId: 'variant-1' },
        { product_id: 'product-1', variant_id: 'variant-1' }
      )
    ).toBe(true);
    expect(
      goalMatchesCartItem(
        { ...baseGoal, variantId: 'variant-1' },
        { product_id: 'product-1', variant_id: null }
      )
    ).toBe(false);
    expect(
      goalMatchesCartItem(
        { ...baseGoal, variantId: 'variant-1' },
        { product_id: 'product-1' }
      )
    ).toBe(false);
  });

  it('classifies only active, paused, and completed savings goals as redeemable', () => {
    expect(isRedeemableSavingsStatus('active')).toBe(true);
    expect(isRedeemableSavingsStatus('paused')).toBe(true);
    expect(isRedeemableSavingsStatus('completed')).toBe(true);
    expect(isRedeemableSavingsStatus('cancelled')).toBe(false);
    expect(isRedeemableSavingsStatus('spent')).toBe(false);
  });

  it('returns null when there are no goals or cart items', () => {
    expect(getEligibleCheckoutSavingsGoal([], [])).toBeNull();
    expect(getEligibleCheckoutSavingsGoal([baseGoal], [])).toBeNull();
    expect(
      getEligibleCheckoutSavingsGoal(
        [],
        [
          {
            product_id: 'product-1',
            variant_id: null,
          },
        ]
      )
    ).toBeNull();
  });

  it('returns the funded savings goal that matches a cart product', () => {
    expect(
      getEligibleCheckoutSavingsGoal(
        [baseGoal],
        [
          {
            product_id: 'product-1',
            variant_id: 'variant-1',
          },
        ]
      )
    ).toBeNull();
    expect(
      getEligibleCheckoutSavingsGoal(
        [baseGoal],
        [
          {
            product_id: 'product-1',
            variant_id: null,
          },
        ]
      )
    ).toEqual(baseGoal);
  });

  it('does not apply a variant-less goal to a specific cart variant', () => {
    expect(
      goalMatchesCartItem(baseGoal, {
        product_id: 'product-1',
        variant_id: 'variant-1',
      })
    ).toBe(false);
  });

  it('requires the cart variant to match when the goal is variant-specific', () => {
    expect(
      getEligibleCheckoutSavingsGoal(
        [
          {
            ...baseGoal,
            variantId: 'variant-2',
          },
        ],
        [
          {
            product_id: 'product-1',
            variant_id: 'variant-1',
          },
        ]
      )
    ).toBeNull();
  });

  it('ignores spent, cancelled, and unfunded goals', () => {
    expect(
      getEligibleCheckoutSavingsGoal(
        [
          {
            ...baseGoal,
            currentAmount: 0,
          },
          {
            ...baseGoal,
            currentAmount: 300000,
            id: 'goal-2',
            status: 'spent',
          },
          {
            ...baseGoal,
            currentAmount: -250000,
            id: 'goal-3',
            status: 'cancelled',
          },
          {
            ...baseGoal,
            currentAmount: 250000,
            id: 'goal-4',
            status: 'spent',
          },
        ],
        [
          {
            product_id: 'product-1',
            variant_id: null,
          },
        ]
      )
    ).toBeNull();
  });

  it('chooses the highest funded matching goal when multiple goals match', () => {
    const lowerGoal = {
      ...baseGoal,
      currentAmount: 75000,
      id: 'goal-2',
    } satisfies SavingsGoal;
    const higherGoal = {
      ...baseGoal,
      currentAmount: 250000,
      id: 'goal-3',
    } satisfies SavingsGoal;

    expect(
      getEligibleCheckoutSavingsGoal(
        [lowerGoal, higherGoal],
        [
          {
            product_id: 'product-1',
            variant_id: null,
          },
        ]
      )
    ).toEqual(higherGoal);
  });

  it('matches any cart item and keeps the first goal when balances tie', () => {
    const firstGoal = {
      ...baseGoal,
      id: 'goal-2',
      productId: 'product-2',
    } satisfies SavingsGoal;
    const secondGoal = {
      ...baseGoal,
      id: 'goal-3',
      productId: 'product-3',
    } satisfies SavingsGoal;

    expect(
      getEligibleCheckoutSavingsGoal(
        [firstGoal, secondGoal],
        [
          {
            product_id: 'product-1',
            variant_id: null,
          },
          {
            product_id: 'product-2',
            variant_id: null,
          },
          {
            product_id: 'product-3',
            variant_id: null,
          },
        ]
      )
    ).toEqual(firstGoal);
  });

  it('allows paused and completed funded goals at checkout', () => {
    const pausedGoal = {
      ...baseGoal,
      id: 'goal-2',
      status: 'paused',
    } satisfies SavingsGoal;
    const completedGoal = {
      ...baseGoal,
      currentAmount: 250000,
      id: 'goal-3',
      status: 'completed',
    } satisfies SavingsGoal;

    expect(
      getEligibleCheckoutSavingsGoal(
        [pausedGoal, completedGoal],
        [
          {
            product_id: 'product-1',
            variant_id: null,
          },
        ]
      )
    ).toEqual(completedGoal);
  });
});
