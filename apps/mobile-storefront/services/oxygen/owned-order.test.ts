import { supabase } from '@/lib/supabase';
import { readOwnedOxygenOrder } from './owned-order';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const orderId = 'aebdc237-5363-4e2b-b0ee-5be12ea9edab';
const customerId = 'c434e49c-8a56-4a4f-82f7-2f4d0e165546';
const merchantId = '3adf89f9-67ec-4dda-9037-e691eec1ff9b';

function mockOrderQuery(
  data: Record<string, unknown>,
  ledger?: {
    walletRows?: Array<{
      amount: number;
      source_type?: string;
      type?: string;
      status?: string;
    }>;
    savingsRows?: Array<{
      amount: number;
      metadata?: Record<string, unknown> | null;
    }>;
  }
) {
  const orderQuery = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data, error: null }),
  };
  const createLedgerQuery = (rows: Record<string, unknown>[]) => {
    interface LedgerChain
      extends Promise<{ data: Record<string, unknown>[]; error: null }> {
      select: jest.Mock<LedgerChain>;
      eq: jest.Mock<LedgerChain>;
    }
    const chain: LedgerChain = Object.assign(
      Promise.resolve({ data: rows, error: null }),
      {
        select: jest.fn((): LedgerChain => chain),
        eq: jest.fn((): LedgerChain => chain),
      }
    );
    return chain;
  };
  jest.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === 'customer_wallet_transactions') {
      return createLedgerQuery(ledger?.walletRows ?? []) as never;
    }
    if (table === 'customer_savings_redemptions') {
      return createLedgerQuery(ledger?.savingsRows ?? []) as never;
    }
    return orderQuery as never;
  });
  return orderQuery;
}

function mockOrder(paymentStatus: string, shippingStatus = 'pending') {
  return mockOrderQuery({
    id: orderId,
    total: 198000,
    payment_method: 'oxygen',
    payment_status: paymentStatus,
    shipping_status: shippingStatus,
  });
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
  'pending',
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

it('returns net payable total after subtracting pre-gateway store credit', async () => {
  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 48000,
    wallet_amount_used: 48000,
    payment_method: 'oxygen',
    payment_status: 'unpaid',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 150000,
    financedPrincipal: 150000,
  });
});

it('rejects an unpaid zero-balance Oxygen order covered 100% by store credit', async () => {
  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 198000,
    wallet_amount_used: 198000,
    payment_method: 'oxygen',
    payment_status: 'unpaid',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).rejects.toMatchObject({
    name: 'ZeroBalanceOxygenOrderError',
    orderId,
    message: expect.stringContaining('zero-balance order'),
  });
});

it('does not treat settled amount_paid as store credit for paid or bnpl_approved orders', async () => {
  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 198000,
    wallet_amount_used: 0,
    payment_method: 'oxygen',
    payment_status: 'paid',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 0,
    financedPrincipal: 198000,
  });

  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 198000,
    wallet_amount_used: 48000,
    payment_method: 'oxygen',
    payment_status: 'paid',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 0,
    financedPrincipal: 150000,
  });

  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 198000,
    wallet_amount_used: 48000,
    payment_method: 'oxygen',
    payment_status: 'bnpl_approved',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 0,
    financedPrincipal: 150000,
  });
});

it('derives financedPrincipal for settled paid and bnpl_approved orders from settled amount_paid minus pre-gateway credit', async () => {
  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 170000,
    wallet_amount_used: 48000,
    payment_method: 'oxygen',
    payment_status: 'paid',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 0,
    financedPrincipal: 122000,
  });

  mockOrderQuery(
    {
      id: orderId,
      total: 198000,
      amount_paid: 168000,
      wallet_amount_used: 0,
      payment_method: 'oxygen',
      payment_status: 'bnpl_approved',
      shipping_status: 'pending',
    },
    {
      walletRows: [
        {
          amount: 30000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'completed',
        },
      ],
      savingsRows: [{ amount: 18000, metadata: {} }],
    }
  );
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 0,
    financedPrincipal: 120000,
  });
});

it('falls back to wallet and savings ledger rows for unpaid and settled Oxygen orders', async () => {
  mockOrderQuery(
    {
      id: orderId,
      total: 198000,
      amount_paid: 30000,
      wallet_amount_used: 30000,
      payment_method: 'oxygen',
      payment_status: 'unpaid',
      shipping_status: 'pending',
    },
    {
      walletRows: [
        {
          amount: 30000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'completed',
        },
      ],
      savingsRows: [{ amount: 18000, metadata: {} }],
    }
  );
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 150000,
    financedPrincipal: 150000,
  });

  mockOrderQuery(
    {
      id: orderId,
      total: 198000,
      amount_paid: 198000,
      wallet_amount_used: 0,
      payment_method: 'oxygen',
      payment_status: 'bnpl_approved',
      shipping_status: 'pending',
    },
    {
      savingsRows: [{ amount: 48000, metadata: {} }],
    }
  );
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 0,
    financedPrincipal: 150000,
  });

  mockOrderQuery(
    {
      id: orderId,
      total: 198000,
      amount_paid: 30000,
      wallet_amount_used: 30000,
      payment_method: 'oxygen',
      payment_status: 'unpaid',
      shipping_status: 'pending',
    },
    {
      walletRows: [
        {
          amount: 150000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'completed',
        },
      ],
      savingsRows: [{ amount: 48000, metadata: {} }],
    }
  );
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).rejects.toMatchObject({
    name: 'ZeroBalanceOxygenOrderError',
    orderId,
    message: expect.stringContaining('zero-balance order'),
  });
});

it('subtracts partial pre-gateway amount_paid on pending orders and ignores reversed ledger credit', async () => {
  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 48000,
    wallet_amount_used: 0,
    payment_method: 'oxygen',
    payment_status: 'pending',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({
    total: 198000,
    payableTotal: 150000,
    financedPrincipal: 150000,
  });

  mockOrderQuery(
    {
      id: orderId,
      total: 198000,
      amount_paid: 30000,
      wallet_amount_used: 30000,
      payment_method: 'oxygen',
      payment_status: 'unpaid',
      shipping_status: 'pending',
    },
    {
      walletRows: [
        {
          amount: 30000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'completed',
        },
        {
          amount: 20000,
          source_type: 'order_redemption',
          type: 'redemption',
          status: 'pending',
        },
        {
          amount: 30000,
          source_type: 'order_reversal',
          type: 'credit',
          status: 'completed',
        },
      ],
      savingsRows: [
        {
          amount: 18000,
          metadata: { reversed_at: '2026-11-25T10:00:00Z' },
        },
      ],
    }
  );
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).resolves.toMatchObject({ total: 198000, payableTotal: 198000 });

  mockOrderQuery({
    id: orderId,
    total: 198000,
    amount_paid: 198000,
    wallet_amount_used: 198000,
    payment_method: 'oxygen',
    payment_status: 'partially_paid',
    shipping_status: 'pending',
  });
  await expect(
    readOwnedOxygenOrder(orderId, customerId, merchantId)
  ).rejects.toThrow('This order is closed');
});
