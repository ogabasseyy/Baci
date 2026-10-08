import { resolveVariantDisplaySelection } from '@baci/shared/lib';
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

  const handleConditionChange = (condition: ProductCondition) => {
    setIgnoredRouteOfferId(offerIdParam);
    // Any explicit pick re-enables offers on a base-row entry.
    setIgnoredRouteBaseMatch(true);
    setSelectedCondition(condition);

    if (!usesVariantConditions) {
      return;
    }

    const nextSelection = resolveVariantDisplaySelection(product, {
      attributes: selectionAttributes,
      condition,
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
