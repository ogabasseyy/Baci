import type { ShippingAddress } from '@/lib/shipping/types';

type ResolveQuoteSenderResult =
  | { ok: true; sender: ShippingAddress }
  | { error: string; ok: false; status: 400 };

const DEFAULT_NIGERIA_SENDER: ShippingAddress = {
  name: 'Merchant',
  phone: '',
  address: 'Lagos',
  city: 'Lagos',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

/** Resolves the final carrier origin after trusted merchant classification. */
export function resolveQuoteSender({
  merchantId,
  sender,
  shipmentType,
}: {
  merchantId?: string;
  sender?: ShippingAddress;
  shipmentType: 'domestic' | 'international';
}): ResolveQuoteSenderResult {
  if (sender) return { ok: true, sender };
  if (merchantId) {
    return {
      error: 'Merchant shipping origin is not configured',
      ok: false,
      status: 400,
    };
  }
  if (shipmentType === 'international') {
    return {
      error: 'Sender is required for international quotes',
      ok: false,
      status: 400,
    };
  }
  return { ok: true, sender: DEFAULT_NIGERIA_SENDER };
}
