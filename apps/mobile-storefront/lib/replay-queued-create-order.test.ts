import type { CreateOrderRequest } from '@/services/orders.schemas';
import { replayQueuedCreateOrder } from './replay-queued-create-order';
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

it('replays a wrapped mutation with its originating generation and skip persist', () => {
  const createOrder = jest.fn();
  replayQueuedCreateOrder(
    createOrder,
    wrapQueuedCreateOrder(request, 'cart-one')
  );
  expect(createOrder).toHaveBeenCalledWith(request, {
    checkoutGeneration: 'cart-one',
    queuedReplay: true,
  });
});
