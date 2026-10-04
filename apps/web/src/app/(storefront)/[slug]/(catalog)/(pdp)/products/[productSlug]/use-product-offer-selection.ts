import {
  type CanonicalProductCondition,
  getVariantConditionOptions,
  hasVariantConditionAxis,
  normalizeCanonicalProductCondition,
  resolveDefaultVariantSelection,
  resolveVariantDisplaySelection,
  resolveVariantSelection,
  resolveVariantSelectionParamResolution,
} from '@baci/shared/lib';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { getEffectiveStock } from '@/lib/product-stock';
import type { Product, ProductVariant } from '@/lib/products';

// Placeholder image for products without images
export const PLACEHOLDER_IMAGE = '/placeholder.svg';

const VALID_CONDITIONS = new Set<CanonicalProductCondition>([
  'new',
  'used',
  'open_box',
]);

export type ProductCondition = CanonicalProductCondition;

function getValidConditionOptions(values: string[]) {
  return values
    .map((value) => normalizeCanonicalProductCondition(value))
    .filter(
      (value): value is ProductCondition =>
        value !== '' && VALID_CONDITIONS.has(value)
    );
}

function areSelectionAttributesEqual(
  left: Record<string, string>,
  right: Record<string, string>
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

/**
 * Extract unique attribute types and their values from variants
 */
function getAttributeOptions(
  variants: ProductVariant[]
): { key: string; values: string[] }[] {
  const attributeMap = new Map<string, Set<string>>();

  for (const variant of variants) {
    for (const [key, value] of Object.entries(variant.attributes)) {
      if (!attributeMap.has(key)) {
        attributeMap.set(key, new Set());
      }
      attributeMap.get(key)?.add(value);
    }
  }

  return Array.from(attributeMap.entries()).map(([key, values]) => ({
    key,
    values: Array.from(values).sort(),
  }));
}

const conditionLabels: Record<string, string> = {
  new: 'New',
  used: 'Premium Used',
  open_box: 'Open Box',
};
const conditionDescriptions: Record<string, string> = {
  new: 'Factory sealed with full manufacturer warranty',
  open_box: 'Opened but unused, all accessories included',
  used: 'Fully tested and inspected, 30-day warranty',
};

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
  const searchParams = useSearchParams();
  const conditionParam = searchParams.get('condition');
  const usesVariantRouteSelection = Boolean(
    product.has_variants && product.variants && product.variants.length > 0
  );
  const routeSelectionResolution = usesVariantRouteSelection
    ? resolveVariantSelectionParamResolution(product, searchParams)
    : null;
  const routeSelectionInput = routeSelectionResolution?.selectionInput ?? {};
  const routeSelectionAttributes = (routeSelectionInput.attributes ??
    {}) as Record<string, string>;
  const routeConditionSource =
    routeSelectionInput.condition ??
    (!usesVariantRouteSelection ? conditionParam : undefined);
  const routeCondition =
    normalizeCanonicalProductCondition(routeConditionSource);
  const routeVariantId = routeSelectionInput.variantId ?? undefined;
  const defaultVariantSelection = usesVariantRouteSelection
    ? resolveDefaultVariantSelection(product, { condition: routeCondition })
    : null;
  const usesVariantConditions = usesVariantRouteSelection
    ? hasVariantConditionAxis(product)
    : false;
  const availableConditionOptions = usesVariantConditions
    ? getValidConditionOptions(getVariantConditionOptions(product))
    : [];
  const [selectedCondition, setSelectedCondition] = useState<ProductCondition>(
    (routeCondition as ProductCondition | undefined) ||
      (defaultVariantSelection?.condition as ProductCondition | undefined) ||
      normalizeCanonicalProductCondition(product.condition) ||
      'new'
  );

  // Search/compare entry points forward the advertised matched offer id.
  // Honor it only when it names one of this product's own offers and matches
  // the selected condition, so the PDP charges the price the card displayed.
  const offerIdParam = searchParams.get('offer_id');
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
      if (routeCondition && routeCondition !== selectedCondition) {
        setSelectedCondition(routeCondition);
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

  // Get current price based on condition offer or variant selection
  const currentPrice =
    selectedOffer?.price != null
      ? Number(selectedOffer.price)
      : (currentVariantDisplaySelection?.price ??
        effectiveVariant?.price_override ??
        product.price);
  const currentCompareAtPrice =
    currentVariantDisplaySelection?.compareAtPrice ?? product.compare_at_price;
  const currentStock = isStockManaged
    ? getEffectiveStock(
        effectiveVariant
          ? {
              stock:
                effectiveVariant.stock_quantity ?? product.stock ?? undefined,
              stock_quantity:
                effectiveVariant.stock_quantity ?? product.stock ?? undefined,
            }
          : selectedOffer
            ? {
                stock: selectedOffer.stock_quantity ?? 0,
                stock_quantity: selectedOffer.stock_quantity ?? 0,
              }
            : product
      )
    : Number.POSITIVE_INFINITY;
  const isOutOfStock = isStockManaged ? currentStock === 0 : false;

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
