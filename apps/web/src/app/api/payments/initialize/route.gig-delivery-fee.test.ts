import { beforeEach, describe, expect, it } from 'vitest';
import {
  enableDvaForTest,
  MERCHANT_ID,
  makeRequest,
  mockCreateDedicatedVirtualAccount,
  mockInitializePaystack,
  ORDER_ID,
  POST,
  resetGigDeliveryFeeMocks,
  rpcCalls,
  serverClientRpcNames,
  setRetainedShippingResult,
  validBody,
} from './route.gig-delivery-fee.test-support';

describe('POST /api/payments/initialize (paystack gateway)', () => {
  beforeEach(resetGigDeliveryFeeMocks);

  describe('bugfix: GIG delivery fee leaked to the merchant subaccount', () => {
    it("includes the customer-paid GIG delivery fee in Baci's Paystack split transaction_charge", async () => {
      setRetainedShippingResult({ data: 120_000, error: null });
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/gig',
      });

      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack' })
      );

      // amount 5000 NGN = 500000 kobo; mocked platform fee = 1.5% = 7500
      expect(res.status).toBe(200);
      expect(rpcCalls).toContainEqual({
        name: 'get_order_paystack_split_retained_shipping_kobo',
        args: {
          p_email: validBody.customer_email,
          p_merchant_id: MERCHANT_ID,
          p_order_id: ORDER_ID,
        },
      });
      // Proof-bound read on the request-scoped client, never the admin one.
      expect(serverClientRpcNames).toContain(
        'get_order_paystack_split_retained_shipping_kobo'
      );
      // The persisted merchant amount excludes the delivery fee Baci keeps:
      // (500000 - 7500 - 120000) kobo.
      expect(rpcCalls).toContainEqual({
        name: 'create_payment_transaction',
        args: expect.objectContaining({
          p_merchant_amount: 3_725,
          p_platform_fee: 75,
        }),
      });
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          subaccount: 'ACCT_TESTMOCK1234567',
          transaction_charge: 7_500 + 120_000,
          bearer: 'account',
          metadata: expect.objectContaining({
            platform_fee_kobo: 7_500,
            retained_shipping_kobo: 120_000,
          }),
        })
      );
    });

    it('keeps transaction_charge at the platform fee for orders without GIG delivery', async () => {
      mockInitializePaystack.mockResolvedValue({
        authorization_url: 'https://paystack.com/pay/plain',
      });

      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack' })
      );

      expect(res.status).toBe(200);
      expect(mockInitializePaystack).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_charge: 7_500,
          metadata: expect.objectContaining({
            platform_fee_kobo: 7_500,
            retained_shipping_kobo: 0,
          }),
        })
      );
    });

    it('does not initialize the split when the retained-shipping lookup fails', async () => {
      setRetainedShippingResult({ data: null, error: { message: 'down' } });

      const res = await POST(
        makeRequest({ ...validBody, gateway: 'paystack' })
      );

      expect(res.status).toBe(502);
      expect(mockInitializePaystack).not.toHaveBeenCalled();
    });

    it('refuses bank transfer (DVA) with 409 when GIG delivery fee must be retained', async () => {
      enableDvaForTest();
      setRetainedShippingResult({ data: 120_000, error: null });

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'paystack',
          payment_type: 'dva',
        })
      );
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('PAYMENT_METHOD_UNAVAILABLE_FOR_SHIPPING');
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('fails closed for DVA when the retained-shipping lookup fails', async () => {
      enableDvaForTest();
      setRetainedShippingResult({ data: null, error: { message: 'down' } });

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'paystack',
          payment_type: 'dva',
        })
      );

      expect(res.status).toBe(503);
      expect(mockCreateDedicatedVirtualAccount).not.toHaveBeenCalled();
    });

    it('still creates a DVA when no shipping fee must be retained', async () => {
      enableDvaForTest();

      const res = await POST(
        makeRequest({
          ...validBody,
          gateway: 'paystack',
          payment_type: 'dva',
        })
      );

      expect(res.status).toBe(200);
      expect(mockCreateDedicatedVirtualAccount).toHaveBeenCalledTimes(1);
    });
  });
});
