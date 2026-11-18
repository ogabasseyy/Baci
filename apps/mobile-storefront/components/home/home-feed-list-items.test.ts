import type { Product } from '@/types/product';
import { buildHomeFeedItems } from './home-feed-list-items';

const products: Product[] = ['second', 'first'].map((id) => ({
  id,
  name: id,
  slug: id,
  price: 1000,
  image: '',
  images: [],
}));
const productItems = products.map((product) => ({ kind: 'product', product }));

it.each([
  false,
  true,
])('omits the pagination sentinel for an empty feed (hasMore: %s)', (hasMore) => {
  expect(buildHomeFeedItems([], hasMore, 'feed')).toEqual([]);
});

it('preserves product order without a pagination sentinel on the last page', () => {
  expect(buildHomeFeedItems(products, false, 'feed')).toEqual(productItems);
});

it.each([
  'before-reset',
  'after-reset',
])('appends a sentinel scoped to feed reset key %s', (key) => {
  expect(buildHomeFeedItems(products, true, key)).toEqual([
    ...productItems,
    { kind: 'product-list-end', id: `home-feed-product-list-end-${key}` },
  ]);
});
