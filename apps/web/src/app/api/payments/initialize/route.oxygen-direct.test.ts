import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MERCHANT_ID,
  makeRequest,
  rpcCalls,
  setRpcResult,
  setupDefaults,
  validBody,
} from './route.initialize-test-fixtures.test-support';
import {
  mockCreateDedicatedVirtualAccount,
  mockInitializePaystack,
  POST,
} from './route.initialize-test-mocks.test-support';

vi.mock('@/lib/payments/resolve-paystack-split-transaction-charge', () => ({
  resolvePaystackSplitTransactionCharge: vi.fn().mockResolvedValue({
    transactionChargeKobo: 7500,
    retainedShippingKobo: 0,
  }),
}));

describe('POST /api/payments/initialize for an Oxygen order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaults();
    mockInitializePaystack.mockResolvedValue({
      authorization_url: 'https://example.test/checkout',
    });
    setRpcResult({
      data: [
        { merchant_id: MERCHANT_ID, total: 5000, payment_method: 'oxygen' },
      ],
      error: null,
    });
  });

  it.each([
    { gateway: 'paystack' },
    { gateway: 'paystack', payment_type: 'dva' },
    { gateway: 'korapay' },
    { gateway: 'juicyway' },
    { gateway: 'credit_direct' },
    { gateway: 'klump' },
  ])('does not start another payment for $gateway', async (choice) => {
    const response = await POST(makeRequest({ ...validBody, ...choice }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('OXYGEN_PAYMENT_IN_PROGRESS');
    expect(mockInitializePaystack).not.toHaveBeenCalled();
    expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(
      rpcCalls.some((call) => call.name === 'create_payment_transaction')
    ).toBe(false);
  });
});
