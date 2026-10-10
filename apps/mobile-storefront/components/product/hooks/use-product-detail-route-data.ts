import { resolveVariantSelectionParamResolution } from '@baci/shared/lib';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { PLACEHOLDER_IMAGE_URL } from '@/constants/Images';
import type { useProduct } from '@/hooks';
import { useNetworkState } from '@/hooks/use-network-state';
import { useReviews } from '@/hooks/use-reviews';
import { normalizeRouteCondition } from '@/lib/product-route/normalize-route-condition';
import { resolveProductVariantMetadata } from '@/lib/product-variant-metadata';
import { getFirstRouteParamValue } from '../product-detail-route-params';
import { getFallbackVariantSelections } from './get-fallback-variant-selections';
import { getFirstImageIndexForColor } from './get-first-image-index-for-color';
import { getSelectionSyncSignature } from './get-selection-sync-signature';
import { useProductDetailSelection } from './use-product-detail-selection';

/**
 * The route product is fetched in the route component (`app/product/[slug].tsx`)
 * and forwarded here, rather than fetched inside this hook. That keeps the
 * fetched product flowing through props so the rendered screen re-renders when
 * the product changes, instead of relying on a frozen, zero-dependency element
 * that React Compiler would otherwise memoize for the whole session.
 */
type UseProductDetailRouteDataArgs = ReturnType<typeof useProduct>;

export function useProductDetailRouteData({
  product,
  isLoading,
  error,
  refetch,
}: UseProductDetailRouteDataArgs) {
  const routeParams = useLocalSearchParams();
  const slug = getFirstRouteParamValue(routeParams.slug);
  const routeConditionParam = getFirstRouteParamValue(routeParams.condition);
  const isValidSlug = Boolean(
    slug && typeof slug === 'string' && slug.length > 0
  );
  const { isOnline } = useNetworkState();
  const reviewsState = useReviews({ productId: product?.id || '' });
  const usesVariantRouteSelection = Boolean(
    product?.has_variants && product.variants && product.variants.length > 0
  );
  const routeSelectionResolution =
    usesVariantRouteSelection && product
      ? resolveVariantSelectionParamResolution(product, routeParams)
      : null;
  const routeSelectionInput = routeSelectionResolution?.selectionInput ?? {};
  const routeSelectionAttributes = (routeSelectionInput.attributes ??
    {}) as Record<string, string>;
  const routeOfferIdParam = getFirstRouteParamValue(routeParams.offer_id);
  // Search/compare entry points mark ID-less base-row matches explicitly:
  // without this identity the entry condition is indistinguishable from a
  // condition-offer selection, and the PDP would adopt the offer's price.
  const routeBaseMatch =
    getFirstRouteParamValue(routeParams.match_base) === '1';
  // ID-only offer links derive the condition from this product's live
  // offer (mirrors web): the snapshot condition is deliberately omitted by
  // entry points because it can be stale, and seeding from the live option
  // keeps the identified offer honored instead of rejected.
  const routeCondition = normalizeRouteCondition(
    routeSelectionInput.condition ??
      (!usesVariantRouteSelection
        ? (routeConditionParam ??
          product?.offers?.find(
            (offer) => String(offer.id) === routeOfferIdParam
          )?.condition)
        : undefined)
  );
  const routeVariantId = routeSelectionInput.variantId ?? null;
  // Search/compare entry points forward the advertised matched offer id.
  // Accept it only when it names one of this product's own offers; the
  // condition-compatibility check happens at selection time so a later
  // condition change on the PDP is never pinned to a stale offer.
  const routeOfferId =
    routeOfferIdParam &&
    product?.offers?.some(
      (offer) => String(offer.id) === String(routeOfferIdParam)
    )
      ? routeOfferIdParam
      : null;
  // An exact offer link whose offer fetch failed must not render as an
  // offerless product: the requested identity would be silently dropped
  // and the shopper could add a different price/condition than opened.
  // Surface the existing error path (retry via refetch) instead.
  const routeOfferHydrationFailed =
    routeOfferIdParam != null &&
    routeOfferIdParam.length > 0 &&
    product?.offers_hydration_failed === true;
  // Exact-match contract, second half: when offers hydrated successfully but
  // the link's offer id is absent (removed or sold), the offer is unavailable
  // — falling back to the parent default would silently advertise a live
  // price for a dead link.
  const routeOfferMissingFromHydratedOffers =
    routeOfferIdParam != null &&
    routeOfferIdParam.length > 0 &&
    product?.offers_hydration_failed !== true &&
    Array.isArray(product?.offers) &&
    !product.offers.some(
      (offer) => String(offer.id) === String(routeOfferIdParam)
    );
  const routeOfferUnavailable =
    routeOfferHydrationFailed || routeOfferMissingFromHydratedOffers;
  const routeOfferHydrationError = routeOfferUnavailable
    ? routeOfferMissingFromHydratedOffers
      ? 'This offer is no longer available. It may have been removed or sold.'
      : 'This offer could not be loaded. Check your connection and try again.'
    : null;
  const routeSelectionSignature = JSON.stringify({
    attributes: Object.fromEntries(
      Object.entries(routeSelectionAttributes).sort(([a], [b]) =>
        a.localeCompare(b)
      )
    ),
    condition: routeCondition,
    slug,
    variantId: routeVariantId,
  });
  const productVariantMetadata = product
    ? resolveProductVariantMetadata({
        colorImages: product.color_images,
        productImages: product.images,
        productColors: product.colors,
        sourceVariantAttributes: product.variant_attributes,
        variants: product.variants,
      })
    : {};
  const productGalleryImages = productVariantMetadata.galleryImages?.length
    ? productVariantMetadata.galleryImages
    : product?.images?.length
      ? product.images
      : product?.image
        ? [product.image]
        : [PLACEHOLDER_IMAGE_URL];
  const productImageColorMap = productVariantMetadata.imageColorMap ?? {};
  const resolvedColorImages =
    productVariantMetadata.colorImages ?? product?.color_images;
  const selection = useProductDetailSelection({
    getFallbackVariantSelections,
    getFirstImageIndexForColor,
    getSelectionSyncSignature,
    product,
    productGalleryImages,
    productImageColorMap,
    resolvedColorImages,
    routeCondition,
    routeSelectionAttributes,
    routeSelectionSignature,
    routeVariantId,
  });
  const { selectedImageIndex, setSelectedImageIndex } = selection;
  const offerConditionKey =
    product?.has_variants === true
      ? null
      : selection.effectiveSelectedCondition ||
        (product?.offers?.length === 1
          ? (product.offers[0]?.condition ?? null)
          : null);
  // A base-row entry keeps the advertised base price until the shopper
  // picks a condition on the PDP (any explicit pick re-enables offers).
  // The entry selection equals the route one, or the entry carries no
  // condition at all (bare flag); ids-bearing links never suppress.
  const suppressConditionOfferMatch =
    routeBaseMatch &&
    !routeOfferId &&
    !routeVariantId &&
    !selection.hasCustomizedSelection &&
    (selection.effectiveSelectedCondition === routeCondition ||
      routeCondition == null);
  const displayProduct = product
    ? {
        ...product,
        color_images: resolvedColorImages,
        colors: productVariantMetadata.colors ?? product.colors,
        variant_attributes:
          productVariantMetadata.variantAttributes ??
          product.variant_attributes,
      }
    : null;
  const hasInvalidSelectionRedirectedRef = useRef(false);

  useEffect(() => {
    if (
      isValidSlug &&
      typeof slug === 'string' &&
      product?.slug &&
      product.slug !== slug
    ) {
      // Canonicalize a legacy slug without dropping the saved selection
      // (the invalid-selection effect below intentionally clears params;
      // a mere slug change must keep variant/offer/base-match identity).
      router.replace({
        pathname: '/product/[slug]',
        params: { ...routeParams, slug: product.slug },
      } as const);
    }
  }, [isValidSlug, product?.slug, routeParams, slug]);

  useEffect(() => {
    if (!product?.slug || product.slug !== slug) return;
    if (!routeSelectionResolution?.extracted.hasRecognizedSelectionParams) {
      hasInvalidSelectionRedirectedRef.current = false;
      return;
    }
    if (
      !hasInvalidSelectionRedirectedRef.current &&
      (routeSelectionResolution.type === 'attribute_only' ||
        routeSelectionResolution.type === 'ambiguous' ||
        routeSelectionResolution.type === 'invalid_variant_id' ||
        routeSelectionResolution.type === 'zero_match')
    ) {
      hasInvalidSelectionRedirectedRef.current = true;
      router.replace(`/product/${product.slug}`);
    }
  }, [
    product?.slug,
    routeSelectionResolution?.extracted.hasRecognizedSelectionParams,
    routeSelectionResolution?.type,
    slug,
  ]);

  useEffect(() => {
    if (selectedImageIndex >= productGalleryImages.length) {
      setSelectedImageIndex(0);
    }
  }, [productGalleryImages.length, selectedImageIndex, setSelectedImageIndex]);

  return {
    displayProduct,
    error: error ?? routeOfferHydrationError,
    isLoading,
    isOnline,
    isValidSlug,
    offerConditionKey,
    product,
    productGalleryImages,
    productImageColorMap,
    refetch,
    resolvedColorImages,
    reviewsState,
    routeOfferHydrationFailed,
    routeOfferId,
    routeParams,
    slug,
    suppressConditionOfferMatch,
    ...selection,
  };
}
