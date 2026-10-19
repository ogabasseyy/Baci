import type { Product } from '@/types/product';
import { createComparisonStore } from './comparison-store';

const product = { id: 'p1', name: 'iPhone' } as Product;

it('keeps selections during use but starts empty in a new app session', () => {
  const firstSession = createComparisonStore();
  expect(firstSession.getState().addProduct(product)).toBe(true);
  expect(firstSession.getState().products).toEqual([product]);
  const nextSession = createComparisonStore();
  expect(nextSession.getState().products).toEqual([]);
  expect(firstSession.getState().products).toEqual([product]);
});

it('preserves selection toggles and the three-product limit within the session', () => {
  const store = createComparisonStore();
  expect(store.getState().toggleComparison(product)).toBe(true);
  expect(store.getState().toggleComparison(product)).toBe(false);
  for (const id of ['a', 'b', 'c'])
    store.getState().addProduct({ id } as Product);
  expect(store.getState().addProduct(product)).toBe(false);
  expect(store.getState().products).toHaveLength(3);
  store.getState().clearComparison();
  expect(store.getState().products).toEqual([]);
});
