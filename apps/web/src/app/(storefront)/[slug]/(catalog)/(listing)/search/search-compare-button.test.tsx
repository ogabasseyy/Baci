import { fireEvent, render as renderWeb, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NormalizedProduct } from '@/lib/normalize-product';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  state: {
    compareItems: [] as {
      id: string;
      name: string;
      slug: string;
    }[],
    isInCompare: vi.fn(() => false),
  },
}));
vi.mock(
  '@/components/storefront/ogabassey/providers/v2-comparison-context',
  () => ({
    useV2Comparison: () => ({
      ...mocks.state,
      addToCompare: mocks.add,
      removeFromCompare: mocks.remove,
      clearCompare: mocks.clear,
    }),
  })
);

import { SearchCompareButton } from './search-compare-button';

import {
  SearchComparisonSession,
  useSearchComparisonIntent,
} from './search-comparison-session';

function ActivateCompare() {
  const { activate } = useSearchComparisonIntent();
  return (
    <button type="button" onClick={activate}>
      Compare fixture
    </button>
  );
}
function render(ui: ReactElement) {
  return renderWeb(
    <SearchComparisonSession scope="phone">
      <ActivateCompare />
      {ui}
    </SearchComparisonSession>
  );
}

beforeEach(() => {
  mocks.state.isInCompare.mockReturnValue(false);
  mocks.clear.mockReset();
  mocks.add.mockReset();
  mocks.remove.mockReset();
  mocks.state.compareItems = [];
});

it('announces the existing fourth-item replacement without touching any cart', () => {
  mocks.state.compareItems = ['1', '2', '3', '4'].map((id) => ({
    id,
    name: `Product ${id}`,
    slug: `p${id}`,
  }));
  // The provider reports the evicted item, which the button announces.
  mocks.add.mockReturnValue({ id: '1', name: 'Product 1', slug: 'p1' });
  render(
    <SearchCompareButton
      product={
        {
          id: '5',
          name: 'Product 5',
          slug: 'p5',
          price: 50,
        } as NormalizedProduct
      }
      price="₦50"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '+ Add to comparison' }));
  expect(mocks.add).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status').textContent).toContain(
    'Replaced Product 1'
  );
});
it('carries the card match basis into the comparison snapshot', () => {
  render(
    <SearchCompareButton
      product={
        {
          id: '5',
          name: 'Product 5',
          slug: 'p5',
          price: 50,
          searchMatch: {
            productId: '5',
            total: 1,
            variantId: 'variant-blue-128',
            condition: 'open_box',
          },
        } as NormalizedProduct
      }
      price="₦50"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '+ Add to comparison' }));
  expect(mocks.add).toHaveBeenCalledWith(
    expect.objectContaining({
      matchVariantId: 'variant-blue-128',
      matchCondition: 'open_box',
    })
  );
});

it('persists a canonical condition for raw match aliases', () => {
  render(
    <SearchCompareButton
      product={
        {
          id: '6',
          name: 'Product 6',
          slug: 'p6',
          price: 60,
          searchMatch: { productId: '6', total: 1, condition: 'uk_used' },
        } as NormalizedProduct
      }
      price="₦60"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: '+ Add to comparison' }));
  // uk_used normalizes to used so the snapshot schema keeps the marker.
  expect(mocks.add).toHaveBeenCalledWith(
    expect.objectContaining({ matchCondition: 'used' })
  );
});
