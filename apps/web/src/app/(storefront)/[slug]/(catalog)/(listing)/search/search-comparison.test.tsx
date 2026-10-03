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
    compareItems: [] as { id: string; name: string; slug: string }[],
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

it('scrolls the card comparison action to the comparison details and clears from a centered action', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    { id: '2', name: 'Two', slug: 'two' },
  ];
  mocks.state.isInCompare.mockReturnValue(true);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false }))
  );
  const scroll = vi.fn();
  const view = render(
    <>
      <SearchCompareButton
        product={{ id: '1', name: 'One' } as NormalizedProduct}
        price="₦100"
      />
      <SearchComparisonTray products={[]} pathPrefix="" merchantId="m1" />
    </>
  );
  expect(
    screen.queryByRole('button', { name: 'View comparison (2) →' })
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: '✓ Added to comparison' })
  );
  Object.defineProperty(
    view.container.querySelector('#search-comparison'),
    'scrollIntoView',
    { value: scroll }
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'View comparison (2) →' })
  );
  expect(scroll).toHaveBeenCalledWith(
    expect.objectContaining({ block: 'start' })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(mocks.clear).toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it('hides comparison again when the search changes, including returning to the original query', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    { id: '2', name: 'Two', slug: 'two' },
  ];
  const children = (
    <>
      <ActivateCompare />
      <SearchComparisonTray products={[]} pathPrefix="" merchantId="m1" />
    </>
  );
  const view = renderWeb(
    <SearchComparisonSession scope="iphone">{children}</SearchComparisonSession>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  expect(
    screen.getByRole('button', { name: 'View comparison (2)' })
  ).toBeTruthy();
  view.rerender(
    <SearchComparisonSession scope="samsung">
      {children}
    </SearchComparisonSession>
  );
  expect(
    screen.queryByRole('button', { name: 'View comparison (2)' })
  ).toBeNull();
  view.rerender(
    <SearchComparisonSession scope="iphone">{children}</SearchComparisonSession>
  );
  expect(
    screen.queryByRole('button', { name: 'View comparison (2)' })
  ).toBeNull();
  expect(mocks.state.compareItems).toHaveLength(2);
});
