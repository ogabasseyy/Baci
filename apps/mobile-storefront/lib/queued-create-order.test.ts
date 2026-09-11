import type { CreateOrderRequest } from '@/services/orders.schemas';
import {
  parseQueuedCreateOrder,
  replayQueuedCreateOrder,
  wrapQueuedCreateOrder,
} from './queued-create-order';

const request = {
  customer_email: 'buyer@example.com',
  customer_name: 'Buyer',
  customer_phone: '+2348012345678',
  items: [{ id: 'item-1', name: 'Buds', price: 1000, quantity: 1 }],
  payment_method: 'pay_on_delivery',
  shipping_address: {
    address: '1 St',
    city: 'Lagos',
    firstName: 'Ada',
    lastName: 'Okafor',
    state: 'Lagos',
  },
  shipping_fee: 500,
  subtotal: 1000,
} as CreateOrderRequest;

it('stores the originating generation with the queued request', () => {
  expect(wrapQueuedCreateOrder(request, 'cart-one')).toEqual({
    checkoutGeneration: 'cart-one',
    request,
  });
});

it('replays a wrapped mutation with its originating generation', () => {
  const createOrder = jest.fn();
  replayQueuedCreateOrder(
    createOrder,
    wrapQueuedCreateOrder(request, 'cart-one')
  );
  expect(createOrder).toHaveBeenCalledWith(request, {
    checkoutGeneration: 'cart-one',
  });
});

it('treats a legacy queued request as the order body without inventing a generation', () => {
  expect(parseQueuedCreateOrder(request)).toEqual({
    checkoutGeneration: '',
    request,
  });
});
