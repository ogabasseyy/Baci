import {
  type CartInputLine,
  type CartSnapshot,
  cartLineIdentity,
} from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import { NativeCartError } from './shared-cart-client';

const CONDITIONS = ['new', 'used', 'open_box', 'refurbished'] as const;
function isNativeCondition(
  value: string
): value is (typeof CONDITIONS)[number] {
  return (CONDITIONS as readonly string[]).includes(value);
}

export function nativeCartInput(line: Omit<CartItem, 'id'>): CartInputLine {
  const normalized = line.condition
    ?.trim()
    .toLowerCase()
    .replace(/[ -]+/g, '_');
  const condition = normalized === 'uk_used' ? 'used' : normalized;
  if (condition && !isNativeCondition(condition))
    throw new NativeCartError('invalid_condition');
  const options = { ...line.variant_attributes };
  if (line.color) options.color = line.color;
  if (line.storage) options.storage = line.storage;
  return {
    item: {
      productId: line.product_id,
      ...(line.variant_id ? { variantId: line.variant_id } : {}),
      ...(line.offer_id ? { offerId: line.offer_id } : {}),
      ...(condition && isNativeCondition(condition) ? { condition } : {}),
      ...(Object.keys(options).length ? { options } : {}),
    },
    ...(line.hasAssurance !== undefined
      ? { hasAssurance: line.hasAssurance }
      : {}),
    quantity: line.voucher_token && line.voucher_award_id ? 1 : line.quantity,
    ...(line.voucher_token ? { voucherToken: line.voucher_token } : {}),
    ...(line.voucher_award_id ? { voucherAwardId: line.voucher_award_id } : {}),
    ...(line.negotiatedPrice !== undefined
      ? { negotiatedUnitPriceMinor: Math.round(line.negotiatedPrice * 100) }
      : {}),
    ...(line.negotiationStatus
      ? { negotiationStatus: line.negotiationStatus }
      : {}),
  };
}
export interface CartProductShell {
  id: string;
  slug: string;
  name: string;
  image?: string;
  brand?: string;
}
export async function hydrateNativeCart(
  snapshot: CartSnapshot,
  cached: CartItem[],
  load: (
    merchantId: string,
    productId: string
  ) => Promise<CartProductShell | null>
): Promise<{ items: CartItem[]; metadataReady: boolean }> {
  let metadataReady = true;
  const products = new Map<string, Promise<CartProductShell | null>>();
  const items = await Promise.all(
    snapshot.lines.map(async (line) => {
      const previous = cached.find((item) => {
        try {
          return (
            cartLineIdentity(nativeCartInput(item).item) ===
              cartLineIdentity(line.item) &&
            item.voucher_award_id === line.voucherAwardId &&
            item.voucher_token === line.voucherToken
          );
        } catch {
          return false;
        }
      });
      if (!products.has(line.item.productId))
        products.set(
          line.item.productId,
          load(snapshot.merchantId, line.item.productId).catch(() => null)
        );
      const loaded = await products.get(line.item.productId);
      const product =
        loaded?.id.toLowerCase() === line.item.productId.toLowerCase()
          ? loaded
          : null;
      if (!product) metadataReady = false;
      return {
        id: line.id,
        product_id: line.item.productId,
        slug: product?.slug ?? previous?.slug ?? line.item.productId,
        name: product?.name ?? previous?.name ?? 'Item unavailable',
        brand: product?.brand,
        image_url: previous?.image_url ?? product?.image,
        variant_id: line.item.variantId,
        offer_id: line.item.offerId,
        variant_attributes: line.item.options,
        color: line.item.options?.color,
        storage: line.item.options?.storage,
        condition: line.item.condition,
        price: line.unitPriceMinor / 100,
        quantity: line.quantity,
        negotiatedPrice:
          line.negotiatedUnitPriceMinor === undefined
            ? undefined
            : line.negotiatedUnitPriceMinor / 100,
        negotiationStatus: line.negotiationStatus,
        voucher_token: line.voucherToken,
        voucher_award_id: line.voucherAwardId,
        hasAssurance: line.hasAssurance,
        assuranceRate: line.assuranceRate,
      };
    })
  );
  return { items, metadataReady };
}
