import type {
  MerchantPickupAddress,
  MerchantRateKind,
} from '@/lib/shipping/merchant-rates/types';

export function redvaultOrderDraftFulfillment(
  rate: {
    kind: MerchantRateKind;
    rateName: string;
    pickupAddress?: MerchantPickupAddress | null;
  } | null,
  rateId: string | null | undefined
) {
  if (!rate) return {};
  return {
    p_merchant_fulfillment: {
      provider: rate.kind === 'pickup' ? 'MERCHANT_PICKUP' : 'MERCHANT',
      rate_id: rateId,
      rate_name: rate.rateName,
      pickup_details:
        rate.kind === 'pickup' ? (rate.pickupAddress ?? null) : null,
    },
  };
}
