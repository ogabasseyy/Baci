import { useCartStore } from '@/stores/cart-store';
import { dropPredictedLines } from './drop-predicted-lines';

const line = (id: string) => ({
  id,
  product_id: 'p',
  slug: 'p',
  name: 'P',
  price: 1,
  quantity: 1,
});

it('removes only predicted lines from the store', () => {
  useCartStore.setState({ items: [line('pending-line::1'), line('real')] });
  dropPredictedLines();
  expect(useCartStore.getState().items.map((i) => i.id)).toEqual(['real']);
});

it('leaves the items untouched when nothing is predicted', () => {
  const items = [line('real')];
  useCartStore.setState({ items });
  dropPredictedLines();
  expect(useCartStore.getState().items).toBe(items);
});
