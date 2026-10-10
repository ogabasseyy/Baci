import {
  normalizeCanonicalProductCondition,
  resolveVariantDisplaySelection,
} from '@baci/shared/lib';
import type { Product, ProductVariant } from '@/lib/products';
import type { ProductCondition } from './product-selection-condition';

export interface ProductSelectionHandlerInputs {
  offerIdParam: string | null;
  product: Product;
  routeSelectionAttributes: Record<string, string>;
  selectedAttributes: Record<string, string>;
  selectedCondition: ProductCondition;
  selectionAttributes: Record<string, string>;
  setIgnoredRouteBaseMatch: (ignored: boolean) => void;
  setIgnoredRouteOfferId: (offerId: string | null) => void;
  setSelectedAttributes: (attributes: Record<string, string>) => void;
  setSelectedCondition: (condition: ProductCondition) => void;
  setSelectedImage: (image: string) => void;
  setSelectedOfferId: (offerId: string | null) => void;
  setSelectedVariant: (variant: ProductVariant | null) => void;
  usesVariantConditions: boolean;
  usesVariantRouteSelection: boolean;
}

/**
 * Shopper-driven PDP selection handlers: attribute and condition picks
 * applied on top of the route-seeded selection. Pure closure factory over
 * the owning hook's state — no selection state lives here.
 */
export function createProductSelectionHandlers(
  inputs: ProductSelectionHandlerInputs
) {
  const {
    offerIdParam,
    product,
    routeSelectionAttributes,
    selectedAttributes,
    selectedCondition,
    selectionAttributes,
    setIgnoredRouteBaseMatch,
    setIgnoredRouteOfferId,
    setSelectedAttributes,
    setSelectedCondition,
    setSelectedImage,
    setSelectedOfferId,
    setSelectedVariant,
    usesVariantConditions,
    usesVariantRouteSelection,
  } = inputs;

  const handleAttributeChange = (attributeKey: string, value: string) => {
    const newAttributes = { ...selectedAttributes, [attributeKey]: value };
    setSelectedAttributes(newAttributes);

    if (!product.variants) {
      return;
    }

    if (usesVariantRouteSelection) {
      const nextSelection = resolveVariantDisplaySelection(product, {
        attributes: {
          ...routeSelectionAttributes,
          ...newAttributes,
        },
        condition: usesVariantConditions ? selectedCondition : undefined,
      });

      if (nextSelection) {
        setSelectedVariant(nextSelection.variant);
        setSelectedAttributes(nextSelection.attributes);
        if (nextSelection.variant.primary_image) {
          setSelectedImage(nextSelection.variant.primary_image);
        }
      } else {
        setSelectedVariant(null);
      }
      return;
    }

    const matchingVariant = product.variants.find((v) =>
      Object.entries(newAttributes).every(
        ([key, val]) => v.attributes[key] === val
      )
    );

    if (matchingVariant) {
      setSelectedVariant(matchingVariant);
      if (matchingVariant.primary_image) {
        setSelectedImage(matchingVariant.primary_image);
      }
    } else {
      setSelectedVariant(null);
    }
  };

  const handleConditionChange = (
    condition: ProductCondition,
    offerId?: string | null
  ) => {
    setIgnoredRouteOfferId(offerIdParam);
    // Any explicit pick re-enables offers on a base-row entry.
    setIgnoredRouteBaseMatch(true);
    // Normalize aliases at the boundary: matching and pricing compare
    // canonical conditions, so storing the raw click value would make
    // every offer comparison fail and revert to the parent product.
    const canonicalCondition = (normalizeCanonicalProductCondition(condition) ||
      condition) as ProductCondition;
    setSelectedCondition(canonicalCondition);
    // Keep the clicked offer keyed by identity: several offers can share
    // one canonical condition, and resolving the click by condition alone
    // would charge the first match instead of the clicked price. Base and
    // variant-axis picks carry no id and clear the explicit selection.
    setSelectedOfferId(offerId ?? null);

    if (!usesVariantConditions) {
      return;
    }

    const nextSelection = resolveVariantDisplaySelection(product, {
      attributes: selectionAttributes,
      condition: canonicalCondition,
    });

    if (nextSelection) {
      setSelectedVariant(nextSelection.variant);
      setSelectedAttributes(nextSelection.attributes);
      if (nextSelection.variant.primary_image) {
        setSelectedImage(nextSelection.variant.primary_image);
      }
    } else {
      setSelectedVariant(null);
    }
  };

  return { handleAttributeChange, handleConditionChange };
}
