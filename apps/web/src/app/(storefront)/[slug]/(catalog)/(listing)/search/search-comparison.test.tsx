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

import { SearchComparisonTray } from './search-comparison';

import { SearchComparisonSession } from './search-comparison-session';
import { useSearchComparisonIntent } from './use-search-comparison-intent';

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

function renderSecondDetailLink(liveMatch: {
  variantId?: string;
  condition?: string;
}) {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    { id: '2', name: 'Two', slug: 'two', matchCondition: 'open_box' },
  ];
  mocks.facts.mockReturnValue({
    products: [
      { id: '1', name: 'One', slug: 'one', price: 200 },
      { id: '2', name: 'Two', slug: 'two', price: 300, condition: 'used' },
    ],
    pending: false,
    error: false,
  });
  render(
    <SearchComparisonTray
      products={[
        {
          id: '2',
          name: 'Two',
          slug: 'two',
          price: 300,
          searchMatch: { productId: '2', total: 1, ...liveMatch },
        } as NormalizedProduct,
      ]}
      pathPrefix=""
      merchantId="m1"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  return screen
    .getAllByRole('link', { name: 'View details and options' })[1]
    .getAttribute('href');
}
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
  // Base condition changed after selection; neither saved nor current
  // search criteria may override the refreshed product facts.
  const href = renderSecondDetailLink({ condition: 'new' });
  expect(href).toContain('condition=used');
  expect(href).not.toContain('condition=new');
});

it('keeps a saved base match from adopting re-filtered live option ids', () => {
  // The live search was re-filtered onto a variant; the saved base match
  // stays authoritative and must not adopt the live option identity.
  const href = renderSecondDetailLink({ variantId: 'v9', condition: 'new' });
  expect(href).toContain('match_base=1');
  expect(href).not.toContain('variant_id=');
  expect(href).not.toContain('offer_id=');
});

it('suppresses parent specs for variant matches and keeps them otherwise', () => {
  mocks.state.compareItems = [
    { id: '1', name: 'One', slug: 'one' },
    {
      id: '2',
      name: 'Two',
      slug: 'two',
      matchVariantId: 'variant-128',
    },
  ];
  mocks.facts.mockReturnValue({
    products: [
      {
        id: '1',
        name: 'One',
        slug: 'one',
        price: 200,
        product_key_specs: { storage: '256 GB' },
      },
      {
        id: '2',
        name: 'Two',
        slug: 'two',
        price: 300,
        product_key_specs: { storage: '256 GB' },
      },
    ],
    pending: false,
    error: false,
  });
  render(<SearchComparisonTray products={[]} pathPrefix="" merchantId="m1" />);
  fireEvent.click(screen.getByRole('button', { name: 'Compare fixture' }));
  // The plain entry shows refreshed parent specs; the variant-matched
  // entry renders Unknown instead of unverified parent values.
  expect(screen.getByText('storage: 256 GB')).toBeTruthy();
  expect(screen.getByText('storage: Unknown')).toBeTruthy();
});
