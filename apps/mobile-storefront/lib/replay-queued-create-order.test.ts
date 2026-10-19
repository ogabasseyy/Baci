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
    wrapQueuedCreateOrder(request, 'cart-one', 'guest')
  );
  expect(createOrder).toHaveBeenCalledWith(request, {
    checkoutGeneration: 'cart-one',
    expectedOwner: 'guest',
    queuedReplay: true,
  });
});

it('does not replay an authenticated queue under a different account', async () => {
  const createOrder = jest.fn();
  await expect(
    replayQueuedCreateOrder(
      createOrder,
      wrapQueuedCreateOrder(
        request,
        'cart-one',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      ),
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    )
  ).rejects.toThrow('Queued checkout belongs to a different account');
  expect(createOrder).not.toHaveBeenCalled();
});

it('does not replay an authenticated queue after sign-out', async () => {
  const createOrder = jest.fn();
  await expect(
    replayQueuedCreateOrder(
      createOrder,
      wrapQueuedCreateOrder(
        request,
        'cart-one',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      )
    )
  ).rejects.toThrow('Queued checkout belongs to a different account');
  expect(createOrder).not.toHaveBeenCalled();
});

it('keeps the reviewed shared-cart binding and canonical line when replaying a queued request', () => {
  const shared_cart = {
    cart_id: '11111111-1111-4111-8111-111111111111',
    checkout_session_id: '22222222-2222-4222-8222-222222222222',
    checkout_generation: 1,
    cart_version: 4,
  };
  const bound = {
    ...request,
    shared_cart,
    items: [
      {
        ...request.items[0],
        cart_line_id: '33333333-3333-4333-8333-333333333333',
      },
    ],
  };
  const createOrder = jest.fn();
  replayQueuedCreateOrder(
    createOrder,
    wrapQueuedCreateOrder(bound, 'cart-one', 'guest')
  );
  expect(createOrder).toHaveBeenCalledWith(
    expect.objectContaining({
      shared_cart,
      items: [
        expect.objectContaining({ cart_line_id: bound.items[0].cart_line_id }),
      ],
    }),
    expect.objectContaining({ queuedReplay: true })
  );
});
