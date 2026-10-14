import { resolveAddedLineAssurance } from '@baci/shared/lib';
import type { Product } from '@/lib/products';
import {
  capAddedSimpleLineQuantity,
  type SimpleLineAddCaps,
} from './cart-stock-caps';
import { DEFAULT_ASSURANCE_RATE, generateCartItemId } from './cart-storage';
import type { AddToCartOptions, CartItem } from './cart-types';
import { findMergingCartLineIndex } from './find-merging-cart-line';

export interface StorefrontCartLineAddAssurance {
  smartCartProEnabled: boolean;
  merchantSlug: string | null;
  hasQuizVoucher: boolean;
  shippingInsuranceEnabled?: boolean;
}

export interface StorefrontCartLineAddInput {
  previousCart: CartItem[];
  product: Product;
  productForCart: Product;
  normalizedOptions?: AddToCartOptions;
  quantity: number;
  caps: SimpleLineAddCaps;
  assurance: StorefrontCartLineAddAssurance;
}

/**
 * Fresh-or-merge line add for `StorefrontCartProvider.addToCart`.
 *
 * Split out of the provider (Boy Scout Rule): the stock-cap gate plus the
 * merge-into-existing / append-new-line branches with the per-line
 * assurance decision. Returns the same cart reference when caps keep the
 * previous cart, so the caller can bail out without further work.
 */
export function applyStorefrontCartLineAdd({
  previousCart,
  product,
  productForCart,
  normalizedOptions,
  quantity,
  caps,
  assurance,
}: StorefrontCartLineAddInput): CartItem[] {
  const cartItemId = generateCartItemId(productForCart.id, normalizedOptions);
  const existingIndex = findMergingCartLineIndex(
    previousCart,
    product,
    normalizedOptions
  );
  if (existingIndex >= 0) {
    const nextCart = [...previousCart];
    const existingItem = nextCart[existingIndex];
    // The merged line may only take remaining pool headroom outside
    // its siblings.
    const capped = capAddedSimpleLineQuantity({
      caps,
      cart: previousCart,
      productId: productForCart.id,
      excludeIndex: existingIndex,
      quantity: existingItem.quantity + quantity,
    });
    if ('keepPrevious' in capped) {
      return previousCart;
    }
    nextCart[existingIndex] = {
      ...existingItem,
      quantity: capped.quantity,
      cartItemId: existingItem.cartItemId || cartItemId,
      hasAssurance: resolveAddedLineAssurance(
        normalizedOptions?.hasAssurance,
        existingItem,
        assurance
      ),
    };
    return nextCart;
  }
  // The new line may only take remaining pool headroom.
  const capped = capAddedSimpleLineQuantity({
    caps,
    cart: previousCart,
    productId: productForCart.id,
    quantity,
  });
  if ('keepPrevious' in capped) {
    return previousCart;
  }
  return [
    ...previousCart,
    {
      ...productForCart,
      cartItemId,
      quantity: capped.quantity,
      variantId: normalizedOptions?.variantId,
      variantAttributes: normalizedOptions?.variantAttributes,
      selectedColor: normalizedOptions?.color,
      selectedColorValue: normalizedOptions?.colorValue,
      secondaryColor: normalizedOptions?.secondaryColor,
      secondaryColorValue: normalizedOptions?.secondaryColorValue,
      selectedStorage: normalizedOptions?.storage,
      condition: normalizedOptions?.condition as
        | 'new'
        | 'used'
        | 'open_box'
        | 'refurbished'
        | undefined,
      offerId: normalizedOptions?.offerId,
      quizAwardId: normalizedOptions?.quizAwardId,
      quizVoucherToken: normalizedOptions?.quizVoucherToken,
      negotiationStatus: 'none',
      hasAssurance: resolveAddedLineAssurance(
        normalizedOptions?.hasAssurance,
        undefined,
        assurance
      ),
      assuranceRate: DEFAULT_ASSURANCE_RATE,
    },
  ];
}
