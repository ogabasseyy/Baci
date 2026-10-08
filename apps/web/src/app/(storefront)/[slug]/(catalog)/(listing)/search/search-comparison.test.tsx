import { fireEvent, render as renderWeb, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { NormalizedProduct } from '@/lib/normalize-product';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  facts: vi.fn(),
  state: {
    compareItems: [] as {
      id: string;
      name: string;
      slug: string;
      brand?: string;
      condition?: string;
      matchVariantId?: string;
      matchOfferId?: string;
      matchCondition?: string;
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
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('./use-search-comparison-facts', () => ({
  useSearchComparisonFacts: mocks.facts,
}));

import { SearchCompareButton, SearchComparisonTray } from './search-comparison';

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
  mocks.facts.mockReturnValue({ products: [], pending: false, error: false });
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
it('refreshes selected identities from other pages and displays real facts', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    { id: '2', name: 'Two', slug: 'two' },
  ];
  mocks.facts.mockReturnValue({
    products: [
      {
        id: '2',
        name: 'Two',
        slug: 'two',
        price: 300,
        brand: 'Apple',
        product_key_specs: { storage: '128 GB' },
      },
    ],
    pending: false,
    error: false,
  });
  render(<SearchComparisonTray products={[]} pathPrefix="" merchantId="m1" />);
  expect(
    screen.queryByRole('button', { name: 'View comparison (2)' })
  ).toBeNull();
  expect(mocks.facts).toHaveBeenLastCalledWith('m1', ['1', '2'], false);
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  expect(
    screen.getByRole('button', { name: 'View comparison (2)' })
  ).toBeTruthy();
  expect(mocks.facts).toHaveBeenLastCalledWith('m1', ['1', '2'], true);
  expect(screen.getByText('storage: 128 GB')).toBeTruthy();
  expect(screen.getByText('Open product for current price')).toBeTruthy();
});

it('falls back to saved brand and condition when refresh misses an item', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one', brand: 'Acme', condition: 'used' },
    { id: '2', name: 'Two', slug: 'two' },
  ];
  mocks.facts.mockReturnValue({
    products: [{ id: '2', name: 'Two', slug: 'two', price: 300 }],
    pending: false,
    error: false,
  });
  render(<SearchComparisonTray products={[]} pathPrefix="" merchantId="m1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  expect(screen.getByText('Brand: Acme')).toBeTruthy();
  expect(screen.getByText('used')).toBeTruthy();
  expect(screen.getByText('Brand: Unknown')).toBeTruthy();
  expect(screen.getByText('Condition not refreshed')).toBeTruthy();
});

it('flags off-page matched snapshots as verify-on-product-page', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    {
      id: '2',
      name: 'Two',
      slug: 'two',
      matchOfferId: 'offer-open-box',
      matchCondition: 'open_box',
    },
  ];
  mocks.facts.mockReturnValue({
    products: [
      { id: '1', name: 'One', slug: 'one', price: 200 },
      { id: '2', name: 'Two', slug: 'two', price: 300 },
    ],
    pending: false,
    error: false,
  });
  // No on-page products: the tray cannot see a live searchMatch, so the
  // snapshot basis is the only signal the card advertised an option.
  render(<SearchComparisonTray products={[]} pathPrefix="" merchantId="m1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  expect(
    screen.getByText('Matched option — verify on product page')
  ).toBeTruthy();
  const detailLinks = screen.getAllByRole('link', {
    name: 'View details and options',
  });
  expect(detailLinks[0]).not.toHaveAttribute(
    'href',
    expect.stringContaining('?')
  );
  expect(detailLinks[1].getAttribute('href')).toContain(
    'offer_id=offer-open-box'
  );
  expect(detailLinks[1].getAttribute('href')).not.toContain('condition=');
});

it('uses the refreshed base condition instead of stale saved or re-filtered conditions', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    {
      id: '2',
      name: 'Two',
      slug: 'two',
      matchCondition: 'open_box',
    },
  ];
  mocks.facts.mockReturnValue({
    products: [
      { id: '1', name: 'One', slug: 'one', price: 200 },
      { id: '2', name: 'Two', slug: 'two', price: 300, condition: 'used' },
    ],
    pending: false,
    error: false,
  });
  // Base condition changed after selection; neither saved nor current
  // search criteria may override the refreshed product facts.
  render(
    <SearchComparisonTray
      products={[
        {
          id: '2',
          name: 'Two',
          slug: 'two',
          price: 300,
          searchMatch: {
            productId: '2',
            total: 1,
            condition: 'new',
          },
        } as NormalizedProduct,
      ]}
      pathPrefix=""
      merchantId="m1"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  const detailLinks = screen.getAllByRole('link', {
    name: 'View details and options',
  });
  expect(detailLinks[1].getAttribute('href')).toContain('condition=used');
  expect(detailLinks[1].getAttribute('href')).not.toContain('condition=new');
});
