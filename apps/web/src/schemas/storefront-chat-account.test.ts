import { expect, it } from 'vitest';
import { storefrontChatAccountSchemas } from './storefront-chat-account';

it('keeps only the bounded order fields needed by the account controls', () => {
  const result = storefrontChatAccountSchemas.orders.parse({
    orders: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        order_number: 'ORD-42',
        payment_status: 'unpaid',
        shipping_status: 'pending',
        customer_email: 'private@example.com',
        virtual_account: { account_number: '0123456789' },
      },
    ],
  });
  expect(result.orders[0]).toEqual({
    id: '11111111-1111-4111-8111-111111111111',
    order_number: 'ORD-42',
    payment_status: 'unpaid',
    shipping_status: 'pending',
  });
});

it('requires an explicit boolean cancellation result', () => {
  expect(
    storefrontChatAccountSchemas.cancellation.safeParse({ success: true })
      .success
  ).toBe(false);
  expect(
    storefrontChatAccountSchemas.cancellation.safeParse({
      success: true,
      cancelled: false,
    }).success
  ).toBe(true);
});
