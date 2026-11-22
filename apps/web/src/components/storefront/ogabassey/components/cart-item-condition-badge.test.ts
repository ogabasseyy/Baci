import { describe, expect, it } from 'vitest';
import { getCartItemConditionBadge } from './cart-item-condition-badge';

describe('getCartItemConditionBadge', () => {
  it('returns themed badge classes for canonical conditions', () => {
    expect(getCartItemConditionBadge({ condition: 'new' })).toEqual({
      label: 'New',
      badgeClassName: 'bg-store-background-text text-store-background',
    });
    expect(
      getCartItemConditionBadge({ variantAttributes: { condition: 'open_box' } })
    ).toEqual({
      label: 'Open Box',
      badgeClassName: 'bg-store-primary text-store-primary-text',
    });
    expect(getCartItemConditionBadge({ condition: 'used' })).toEqual({
      label: 'Used',
      badgeClassName: 'bg-store-background-text/80 text-store-background',
    });
    expect(getCartItemConditionBadge({})).toBeNull();
  });
});
