import {
  normalizeCanonicalProductCondition,
  resolveDefaultVariantSelection,
  resolveVariantDisplaySelection,
  resolveVariantSelection,
} from '@baci/shared/lib';
import { useState } from 'react';
import type { Product, ProductVariant } from '@/lib/products';
import {
  areSelectionAttributesEqual,
  conditionDescriptions,
  conditionLabels,
  getAttributeOptions,
  PLACEHOLDER_IMAGE,
  type ProductCondition,
  resolveSelectionPricing,
} from './product-selection-utils';
import { useProductRouteSelection } from './use-product-route-selection';

/**
 * Route-driven offer, variant, condition, and image selection for the PDP,
 * plus the price/stock derived from that selection. Search/compare entry
 * points forward the advertised matched offer id; it is honored only when
 * it names one of this product's own offers and matches the selected
 * condition, so the PDP charges the price the card displayed.
 */
export function useProductOfferSelection(product: Product) {
  const [selectedImage, setSelectedImage] = useState(
    product.imageLarge || product.image || PLACEHOLDER_IMAGE
  );

  // Variant selection state
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    null
  );
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >({});

  // Condition offer state
  const {
    availableConditionOptions,
    defaultVariantSelection,
    offerIdParam,
    routeCondition,
    routeSelectionAttributes,
    routeVariantId,
    usesVariantConditions,
    usesVariantRouteSelection,
  } = useProductRouteSelection(product);
  const [selectedCondition, setSelectedCondition] = useState<ProductCondition>(
    (routeCondition as ProductCondition | undefined) ||
      (defaultVariantSelection?.condition as ProductCondition | undefined) ||
      normalizeCanonicalProductCondition(product.condition) ||
      'new'
  );

  // Search/compare entry points forward the advertised matched offer id.
  // Honor it only when it names one of this product's own offers and matches
  // the selected condition, so the PDP charges the price the card displayed.
  const [ignoredRouteOfferId, setIgnoredRouteOfferId] = useState<string | null>(
    null
  );
  const routeOfferId =
    offerIdParam &&
    offerIdParam !== ignoredRouteOfferId &&
    product.offers?.some((o: { id: string }) => String(o.id) === offerIdParam)
      ? offerIdParam
      : null;
  const selectedOffer = usesVariantConditions
    ? null
    : (routeOfferId &&
        product.offers?.find(
          (offer: { id: string; condition: string }) =>
            String(offer.id) === routeOfferId &&
            normalizeCanonicalProductCondition(offer.condition) ===
              selectedCondition
        )) ||
      (selectedCondition !==
      (normalizeCanonicalProductCondition(product.condition) || 'new')
        ? product.offers?.find(
            (offer: { condition: string }) =>
              normalizeCanonicalProductCondition(offer.condition) ===
              selectedCondition
          )
        : null) ||
      null;

  // Seed the selection state from the route-driven inputs inline during
  // render with a prev-key comparison (react.dev: "Adjusting some state when
  // a prop changes"). The previous useEffect version committed a stale frame
  // before re-rendering with the seeded selection.
  const routeSeedKey = [
    product.id,
    usesVariantRouteSelection ? 'variants' : 'simple',
    routeCondition,
    routeVariantId ?? '',
    offerIdParam ?? '',
    Object.entries(routeSelectionAttributes)
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('&'),
  ].join('|');
  const [prevRouteSeedKey, setPrevRouteSeedKey] = useState<string | null>(null);
  if (routeSeedKey !== prevRouteSeedKey) {
    setPrevRouteSeedKey(routeSeedKey);
    setIgnoredRouteOfferId(null);

    if (!usesVariantRouteSelection) {
      // An ID-only offer that stops resolving (removed offer, or offer_id
      // leaving the URL) clears the route condition; reseed to the parent
      // default instead of keeping the stale offer condition, which could
      // otherwise fall through to a different same-condition offer.
      const nextCondition =
        routeCondition ||
        normalizeCanonicalProductCondition(product.condition) ||
        'new';
      if (nextCondition !== selectedCondition) {
        setSelectedCondition(nextCondition);
      }
    } else {
      const fallbackVariantSelection = resolveDefaultVariantSelection(product, {
        condition: routeCondition,
      });
      const seedSelection =
        resolveVariantDisplaySelection(product, {
          attributes: routeSelectionAttributes,
          condition: routeCondition,
          variantId: routeVariantId,
        }) ?? fallbackVariantSelection;

      const nextCondition =
        routeCondition ||
        (seedSelection?.condition as ProductCondition | undefined) ||
        normalizeCanonicalProductCondition(product.condition) ||
        'new';
      if (nextCondition !== selectedCondition) {
        setSelectedCondition(nextCondition);
      }

      if (!seedSelection) {
        if (selectedVariant !== null) {
          setSelectedVariant(null);
        }
        if (Object.keys(selectedAttributes).length > 0) {
          setSelectedAttributes({});
        }
        const fallbackImage =
          product.imageLarge || product.image || PLACEHOLDER_IMAGE;
        if (selectedImage !== fallbackImage) {
          setSelectedImage(fallbackImage);
        }
      } else {
        if (selectedVariant?.id !== seedSelection.variant.id) {
          setSelectedVariant(seedSelection.variant);
        }
        if (
          !areSelectionAttributesEqual(
            selectedAttributes,
            seedSelection.attributes
          )
        ) {
          setSelectedAttributes(seedSelection.attributes);
        }
        const nextImage =
          seedSelection.variant.primary_image ||
          product.imageLarge ||
          product.image ||
          PLACEHOLDER_IMAGE;
        if (selectedImage !== nextImage) {
          setSelectedImage(nextImage);
        }
      }
    }
  }

  // Get variant options if product has variants
  const attributeOptions = product.has_variants
    ? getAttributeOptions(product.variants || [])
    : [];
  // Legacy `NULL` manage_stock rows are treated as unlimited inventory.
  const isStockManaged = product.manage_stock ?? false;
  const selectionAttributes = {
    ...routeSelectionAttributes,
    ...selectedAttributes,
  };
  const currentVariantDisplaySelection = usesVariantRouteSelection
    ? resolveVariantDisplaySelection(product, {
        attributes: selectionAttributes,
        condition: usesVariantConditions ? selectedCondition : undefined,
      })
    : null;
  const currentVariantSelection = usesVariantRouteSelection
    ? resolveVariantSelection(product, {
        attributes: selectionAttributes,
        condition: usesVariantConditions ? selectedCondition : undefined,
      })
    : null;
  const effectiveVariant =
    currentVariantDisplaySelection?.variant ?? selectedVariant;
  const effectiveVariantAttributes =
    currentVariantDisplaySelection?.attributes ?? selectionAttributes;
  const effectiveVariantId =
    currentVariantSelection?.variant.id ?? effectiveVariant?.id;

  const { currentPrice, currentCompareAtPrice, currentStock, isOutOfStock } =
    resolveSelectionPricing({
      product,
      selectedOffer,
      displaySelection: currentVariantDisplaySelection,
      effectiveVariant,
      isStockManaged,
    });

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

  return {
    attributeOptions,
    availableConditionOptions,
    conditionDescriptions,
    conditionLabels,
    currentCompareAtPrice,
    currentPrice,
    currentStock,
    currentVariantSelection,
    effectiveVariant,
    effectiveVariantAttributes,
    effectiveVariantId,
    handleAttributeChange,
    handleConditionChange,
    isOutOfStock,
    isStockManaged,
    selectedCondition,
    selectedImage,
    selectedOffer,
    setSelectedImage,
    usesVariantConditions,
  };
}
