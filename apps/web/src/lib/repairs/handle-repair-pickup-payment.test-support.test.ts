// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createRepairPickupPaymentMetadata,
  createRepairPickupPaymentSupabase,
  repairPickupPaymentTestMerchantId,
  repairPickupPaymentTestReference,
  repairPickupPaymentTestRepairId,
  repairPickupPaymentTestSecret,
} from './handle-repair-pickup-payment.test-support';
import { repairPickupPaymentClaims } from './repair-pickup-payment-claim';

describe('handle-repair-pickup-payment.test-support', () => {
  it('builds signed repair pickup payment metadata for webhook tests', () => {
    const metadata = createRepairPickupPaymentMetadata();

    expect(metadata).toEqual({
      currency: 'NGN',
      merchant_id: repairPickupPaymentTestMerchantId,
      pickup_amount_kobo: 825_000,
      pickup_claim_signature: expect.stringMatching(/^[a-f0-9]{64}$/),
      pickup_claim_version: 1,
      reference: repairPickupPaymentTestReference,
      repair_id: repairPickupPaymentTestRepairId,
      transaction_type: 'repair_pickup',
    });
    expect(
      repairPickupPaymentClaims.verify(metadata, repairPickupPaymentTestSecret)
    ).toEqual({
      amountKobo: 825_000,
      currency: 'NGN',
      merchantId: repairPickupPaymentTestMerchantId,
      reference: repairPickupPaymentTestReference,
      repairId: repairPickupPaymentTestRepairId,
    });
  });

  it('creates a supabase mock that confirms payment by default', async () => {
    const { rpc } = createRepairPickupPaymentSupabase();

    const { data, error } = await rpc('confirm_repair_pickup_payment', {
      p_amount: 8250,
      p_currency: 'NGN',
      p_gateway_response: {},
      p_merchant_id: repairPickupPaymentTestMerchantId,
      p_reference: repairPickupPaymentTestReference,
      p_repair_id: repairPickupPaymentTestRepairId,
    });

    expect(error).toBeNull();
    expect(data).toEqual([{ confirmed: true }]);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('creates a supabase mock that reports an unconfirmed duplicate claim', async () => {
    const { rpc } = createRepairPickupPaymentSupabase(false);

    const { data } = await rpc('confirm_repair_pickup_payment', {});

    expect(data).toEqual([{ confirmed: false }]);
  });
});
