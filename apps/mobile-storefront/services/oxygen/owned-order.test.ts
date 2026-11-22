import { supabase } from '@/lib/supabase';
import { readOwnedOxygenOrder } from './owned-order';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const orderId = 'aebdc237-5363-4e2b-b0ee-5be12ea9edab';
const customerId = 'c434e49c-8a56-4a4f-82f7-2f4d0e165546';
const merchantId = '3adf89f9-67ec-4dda-9037-e691eec1ff9b';

function mockOrder(paymentStatus: string, shippingStatus = 'pending') {
  const query = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: orderId,
        total: 198000,
        payment_method: 'oxygen',
        payment_status: paymentStatus,
        shipping_status: shippingStatus,
      },
      error: null,
    }),
  };
  jest.mocked(supabase.from).mockReturnValue(query as never);
  return query;
}

it.each([
  'cancelled',
  'canceled',
  'expired',
  'failed',
  'refunded',
])('rejects direct checkout links for %s orders', async (status) => {
  mockOrder(status);
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).rejects.toThrow('This order is closed');
});

it.each([
  'unpaid',
  'paid',
  'bnpl_approved',
])('allows an owned %s order to load its canonical confirmation state', async (status) => {
  const query = mockOrder(status);
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({ payment_status: status });
  expect(query.eq.mock.calls).toEqual([
    ['id', orderId],
    ['customer_id', customerId],
    ['merchant_id', merchantId],
  ]);
});

it('rejects an unpaid order with cancelled shipping', async () => {
  mockOrder('unpaid', 'canceled');
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).rejects.toThrow('This order is closed');
});

it.each([
  'delivered',
  'completed',
])('sends a delivered or completed order to history (%s)', async (status) => {
  mockOrder('paid', status);
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).rejects.toThrow('This order is closed');
});
