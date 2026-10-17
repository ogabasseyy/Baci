import type { ResolvedProductVariantSelection } from '@baci/shared/lib';
import {
  resolveCurrentOffer,
  type ProductDetailsCurrentOffer,
} from './offer-resolution';
import type { ConditionType } from './product-details-helpers';
import type { NormalizedProductDetails } from './product-normalization';

type DetailsVariantSelection = ResolvedProductVariantSelection<{
  id: string;
  price_override?: number | null;
  price_modifier?: number | null;
  stock_quantity?: number | null;
  inventory_tracking_policy?: string | null;
}> | null;

/**
 * Display/cart offer resolution plus the stock gate for the current
 * selection. Pure derivation — the state hook owns the inputs.
 */
export function resolveProductDetailsOfferState(args: {
  currentCartVariantSelection: DetailsVariantSelection | undefined;
  currentVariantDisplaySelection: DetailsVariantSelection | undefined;
  currentVariantSelection: DetailsVariantSelection | undefined;
  productData: NormalizedProductDetails;
  routeOfferId: string | null;
  selectedCondition: ConditionType;
  variantSelectionAttributes: Record<string, string>;
}): {
  canPurchase: boolean;
  currentCartOffer: ProductDetailsCurrentOffer;
  currentOffer: ProductDetailsCurrentOffer;
  managesStock: boolean;
} {
  const {
    currentCartVariantSelection,
    currentVariantDisplaySelection,
    currentVariantSelection,
    productData,
    routeOfferId,
    selectedCondition,
    variantSelectionAttributes,
  } = args;
  const currentOffer = resolveCurrentOffer(
    productData,
    selectedCondition,
    variantSelectionAttributes,
    currentVariantDisplaySelection,
    routeOfferId
  );
  const currentCartOffer = resolveCurrentOffer(
    productData,
    selectedCondition,
    variantSelectionAttributes,
    currentCartVariantSelection,
    routeOfferId
  );
  const managesStock = productData.manage_stock !== false;
  // Offer selections bypass the unmanaged pass: the cart and order paths
  // enforce the finite offer allocation even on unmanaged parents.
  const canPurchase =
    (productData.variants?.length ?? 0) > 0
      ? Boolean(currentVariantSelection) &&
        (!managesStock || currentCartOffer.stock > 0)
      : (!managesStock && currentOffer.offerId == null) ||
        currentOffer.stock > 0;
  return { canPurchase, currentCartOffer, currentOffer, managesStock };
}
