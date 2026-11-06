import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';

export function getChatDeliveryContext(input: {
  lines: Array<{
    cartItemId: string;
    quantity: number;
    price: number;
    negotiatedPrice?: number | null;
  }>;
  subtotal: number;
  sharedVersion?: string | number;
  hydrated: boolean;
  routingMode?: string;
  merchantId?: string;
  merchantSlug?: string;
  cartMerchantSlug?: string | null;
  country?: string;
  payoutCurrency?: string | null;
}): { cartKey: string; eligible: boolean } {
  const country = input.country?.trim().toUpperCase() ?? '';
  const eligible = input.hydrated && input.lines.length > 0 &&
    Boolean(input.cartMerchantSlug) && Boolean(input.merchantSlug) &&
    input.cartMerchantSlug === input.merchantSlug &&
    input.routingMode === 'domain' && country === 'NG' &&
    resolveMerchantCurrencyConfig({
      country,
      payout_currency: input.payoutCurrency ?? null,
    }).code === 'NGN';

  const cartKey = JSON.stringify({
    lines: input.lines.map((item) => [item.cartItemId, item.quantity, item.price, item.negotiatedPrice]),
    subtotal: input.subtotal,
    sharedVersion: input.sharedVersion,
    merchantId: input.merchantId,
    merchantSlug: input.merchantSlug,
    cartMerchantSlug: input.cartMerchantSlug,
    country: input.country,
    payoutCurrency: input.payoutCurrency,
    routingMode: input.routingMode,
  });

  return { cartKey, eligible };
}
