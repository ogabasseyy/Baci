import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductGridAdBreak } from './product-grid-ad-break';

vi.mock('./AdUnit', () => ({
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

describe('ProductGridAdBreak', () => {
  it('requests the grid ad with its own slot instance', () => {
    render(<ProductGridAdBreak slotInstance="engine-12" viewMode="grid" />);

    const ad = screen.getByTestId('ad-unit');
    expect(ad).toHaveAttribute('data-placement', 'PRODUCT_GRID_MPU');
    expect(ad).toHaveAttribute('data-slot-instance', 'engine-12');
  });

  it('spans the whole grid row in grid view', () => {
    render(<ProductGridAdBreak slotInstance="engine-12" viewMode="grid" />);

    expect(screen.getByTestId('product-grid-ad-break')).toHaveClass(
      'col-span-2',
      'lg:col-span-4'
    );
  });

  it('takes the full width in list view', () => {
    render(<ProductGridAdBreak slotInstance="engine-12" viewMode="list" />);

    const row = screen.getByTestId('product-grid-ad-break');
    expect(row).toHaveClass('w-full');
    expect(row).not.toHaveClass('lg:col-span-4');
  });
});
