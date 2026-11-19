import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CartInFeedAd } from './cart-in-feed-ad';

vi.mock('../components/AdUnit', () => ({
  AdUnit: ({
    placementKey,
    slotInstance,
  }: {
    placementKey: string;
    slotInstance?: string;
  }) => (
    <div
      data-placement={placementKey}
      data-slot-instance={slotInstance}
      data-testid="ad-unit"
    />
  ),
}));

describe('CartInFeedAd', () => {
  it('requests the grid ad unit under its own cart slot instance', () => {
    render(<CartInFeedAd />);

    const ad = screen.getByTestId('ad-unit');
    expect(ad).toHaveAttribute('data-placement', 'PRODUCT_GRID_MPU');
    expect(ad).toHaveAttribute('data-slot-instance', 'cart');
  });
});
