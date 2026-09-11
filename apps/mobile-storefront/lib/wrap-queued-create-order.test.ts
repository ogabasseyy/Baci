import type { CreateOrderRequest } from '@/services/orders.schemas';
import { wrapQueuedCreateOrder } from './wrap-queued-create-order';

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
  expect(wrapQueuedCreateOrder(request, 'cart-one', 'guest')).toEqual({
    authPartition: 'guest',
    checkoutGeneration: 'cart-one',
    request,
  });
});
