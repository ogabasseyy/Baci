import { expect, it } from 'vitest';
import { asRoute } from '@/lib/routes';
import { getBlackFridayLineupView } from './black-friday-lineup-view';

const lineup: Parameters<typeof getBlackFridayLineupView>[0] = [
  { brand: 'Samsung', priceAmount: 200 },
  { brand: 'Apple', priceAmount: 300 },
  { brand: 'Motorola', priceAmount: 100 },
].map(({ brand, priceAmount }) => ({
  id: brand,
  name: brand,
  slug: brand.toLowerCase(),
  href: asRoute('/phones'),
  image: '',
  price: `₦${priceAmount}`,
  rawPrice: priceAmount,
  priceAmount,
  brand,
  storage: undefined,
  ram: undefined,
  graphics: undefined,
  colors: undefined,
  simType: undefined,
  displayType: undefined,
  displaySize: undefined,
  condition: undefined,
  compareAtPrice: undefined,
}));

it('normalizes repeated facet values and ignores unknown options', () => {
  const { filters, products } = getBlackFridayLineupView(lineup, {
    brand: ['Samsung', 'unknown', 'Apple', 'Samsung'],
    storage: 'unknown',
  });
  expect(filters.brand).toEqual(['Apple', 'Samsung']);
  expect(filters.storage).toEqual([]);
  expect(products.map(({ brand }) => brand)).toEqual(['Samsung', 'Apple']);
});

it.each([
  { minPrice: 'Infinity', maxPrice: '-1' },
  { minPrice: ['150', '200'], maxPrice: ['100'] },
  { minPrice: 'invalid', maxPrice: '0' },
])('ignores malformed or non-positive price bounds (%j)', (query) => {
  const { filters, products } = getBlackFridayLineupView(lineup, query);
  expect(filters).toMatchObject({ minPrice: 0, maxPrice: 0 });
  expect(products.map(({ brand }) => brand)).toEqual([
    'Samsung',
    'Apple',
    'Motorola',
  ]);
});

it('includes offers on the specified price boundaries', () => {
  const { products } = getBlackFridayLineupView(lineup, {
    minPrice: '200',
    maxPrice: '300',
  });
  expect(products.map(({ priceAmount }) => priceAmount)).toEqual([200, 300]);
});

it.each([
  { sort: 'price-asc', prices: [100, 200, 300] },
  { sort: 'price-desc', prices: [300, 200, 100] },
])('applies $sort without mutating the lineup', ({ sort, prices }) => {
  const view = getBlackFridayLineupView(lineup, { sort });
  expect(view.sort).toBe(sort);
  expect(view.products.map(({ priceAmount }) => priceAmount)).toEqual(prices);
  expect(lineup.map(({ priceAmount }) => priceAmount)).toEqual([200, 300, 100]);
});

it('returns no offers or selectable facets for an empty lineup', () => {
  const view = getBlackFridayLineupView([], { brand: 'Apple' });
  expect(view.products).toEqual([]);
  expect(view.availableOptions.brand).toEqual([]);
  expect(view.filters.brand).toEqual([]);
});
