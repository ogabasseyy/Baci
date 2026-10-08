import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MERCHANT_ID,
  makeRequest,
  rpcCalls,
  setMerchantResult,
  setRpcResult,
  setSavingsRedemptionsResult,
  setupDefaults,
  validBody,
} from './route.initialize-test-fixtures.test-support';
import {
  mockCreateDedicatedVirtualAccount,
  mockInitializePaystack,
  POST,
  routeMocks,
} from './route.initialize-test-mocks.test-support';

describe('POST /api/payments/initialize REDVAULT private pilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('JUICYWAY_SECRET_KEY', 'test-juicyway-key');
    mockCreateDedicatedVirtualAccount.mockResolvedValue({
      account_name: 'Test Store / John Doe',
      account_number: '1234567890',
      bank_name: 'Wema Bank',
    });
    setupDefaults();
  });

  it.each([
    null,
    { id: '11111111-1111-4111-8111-111111111111' },
  ])('rejects a private pilot payment for an unauthorized identity %j before provider access', async (user) => {
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    routeMocks.authenticateApiRequest.mockResolvedValue({ user });
    const response = await POST(
      makeRequest({ ...validBody, payment_method: 'uba_redvault' })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('REDVAULT_UNAVAILABLE');
    expect(mockInitializePaystack).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it.each([
    'wallet',
    'savings',
  ])('rejects persisted %s funding for the private pilot', async (funding) => {
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
      reason: 'private_live_pilot',
    });
    routeMocks.authenticateApiRequest.mockResolvedValue({
      user: { id: '70261bce-d358-45a4-9ede-8b9d71fb3bd9' },
    });
    routeMocks.getRedvaultLivePilotPolicy.mockReturnValue({
      merchantId: MERCHANT_ID,
    });
    routeMocks.getRedvaultCheckoutSummary.mockResolvedValue({
      order: { currency: 'NGN', total: 95 },
      quote: {
        product_subtotal_kobo: 10000,
        eligible_subtotal_kobo: 10000,
        ineligible_subtotal_kobo: 0,
        discount_kobo: 500,
        assurance_fee_kobo: 0,
        shipping_kobo: 0,
        gift_wrapping_kobo: 0,
        tax_kobo: 0,
        payable_kobo: 9500,
        mixed_basket: false,
      },
    });
    setRpcResult({
      data: [
        {
          merchant_id: MERCHANT_ID,
          payment_method: 'uba_redvault',
          total: 95,
          wallet_amount_used: funding === 'wallet' ? 1 : 0,
        },
      ],
      error: null,
    });
    if (funding === 'savings')
      setSavingsRedemptionsResult({ data: [{ amount: 1 }], error: null });
    const response = await POST(
      makeRequest({ ...validBody, payment_method: 'uba_redvault' })
    );
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('REDVAULT_UNAVAILABLE');
    expect(mockInitializePaystack).not.toHaveBeenCalled();
    expect(
      rpcCalls.some(
        (call) => call.name === 'reserve_storefront_redvault_payment_attempt_v3'
      )
    ).toBe(false);
  });
  it('maps an invalid REDVAULT callback host to 409 without touching the provider', async () => {
    routeMocks.getRedvaultPaymentAvailability.mockReturnValue({
      available: true,
    });
    setRpcResult({
      data: [
        {
          merchant_id: MERCHANT_ID,
          payment_method: 'uba_redvault',
          total: 5000,
          tracking_token: 'track-token-123',
        },
      ],
      error: null,
    });
    setMerchantResult({
      data: {
        id: MERCHANT_ID,
        business_name: 'Test Store',
        slug: 'evil.shop/x',
        paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      },
      error: null,
    });

    const res = await POST(
      makeRequest({
        ...validBody,
        payment_method: 'uba_redvault',
        tracking_token: 'track-token-123',
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('REDVAULT_UNAVAILABLE');
    expect(mockInitializePaystack).not.toHaveBeenCalled();
  });
});
