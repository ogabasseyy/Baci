import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import type { useProduct } from '@/hooks';
import { markReviewHelpful } from '@/hooks/use-reviews';
import { createLogger } from '@/lib/logger';
import { trackProductRouteWishlistAdd } from '@/services/tiktok-product-route-tracking';
import { useSavedStore } from '@/stores/saved-store';
import { getDiscountPercentage } from '@/types/product';
import { useProductDetailAnimations } from './hooks/use-product-detail-animations';
import { useProductDetailCartActions } from './hooks/use-product-detail-cart-actions';
import { useProductDetailCartState } from './hooks/use-product-detail-cart-state';
import { useProductDetailPurchaseState } from './hooks/use-product-detail-purchase-state';
import { useProductDetailRouteData } from './hooks/use-product-detail-route-data';
import { useProductDetailSelectionHandlers } from './hooks/use-product-detail-selection-handlers';
import { useSavedToastAutoDismiss } from './hooks/use-saved-toast-auto-dismiss';
import { ProductDetailLoadedView } from './ProductDetailLoadedView';
import { ProductDetailRouteState } from './ProductDetailRouteState';

const log = createLogger('ProductDetail');

const handleProductRouteBack = (): void => {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/');
};

type ProductDetailScreenProps = ReturnType<typeof useProduct>;

export function ProductDetailScreen({
  product: routeProduct,
  isLoading: routeIsLoading,
  error: routeError,
  refetch: routeRefetch,
}: ProductDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const routeData = useProductDetailRouteData({
    product: routeProduct,
    isLoading: routeIsLoading,
    error: routeError,
    refetch: routeRefetch,
  });
  const animations = useProductDetailAnimations(colors);
  const toggleSaved = useSavedStore((state) => state.toggleSaved);
  const isSaved = useSavedStore((state) => state.isSaved);
  const savedToastState = useSavedStore((state) => state.toastState);
  const dismissSavedToast = useSavedStore((state) => state.dismissToast);
  const [showImageZoom, setShowImageZoom] = useState(false);
  const cartState = useProductDetailCartState(routeData);
  const purchaseState = useProductDetailPurchaseState(
    routeData,
    cartState.quantityInCart,
    null,
    cartState.productQuantityInCart
  );
  const cartActions = useProductDetailCartActions(
    routeData,
    cartState,
    purchaseState
  );
  const selectionHandlers = useProductDetailSelectionHandlers(routeData);
  useSavedToastAutoDismiss(savedToastState.show, dismissSavedToast);

  if (!routeData.isValidSlug) {
    return (
      <ProductDetailRouteState
        colors={colors}
        onGoBack={handleProductRouteBack}
        state="invalid"
      />
    );
  }
  if (routeData.isLoading) {
    return <ProductDetailRouteState colors={colors} state="loading" />;
  }
  if (routeData.error || !routeData.product) {
    if (!routeData.isOnline) {
      return (
        <ProductDetailRouteState
          colors={colors}
          onRetry={() => routeData.refetch()}
          state="offline"
        />
      );
    }
    return (
      <ProductDetailRouteState
        colors={colors}
        error={routeData.error}
        onGoBack={handleProductRouteBack}
        state="error"
      />
    );
  }

  const product = routeData.product;
  const reviewsState = routeData.reviewsState;
  const handleShare = async () => {
    try {
      const result = await Share.share({
        message: `Check out the ${product.name} on Ogabassey: https://ogabassey.com/product/${product.slug}`,
        title: product.name,
      });
      if (result.action === Share.sharedAction) {
        log.info('Product shared successfully');
      }
    } catch (err) {
      log.error('Share error:', err);
      if (err instanceof Error && !err.message.includes('cancel')) {
        Alert.alert(
          'Unable to Share',
          'There was a problem sharing this product. Please try again.',
          [{ text: 'OK' }]
        );
      }
    }
  };

  return (
    <ProductDetailLoadedView
      backButtonAnimatedStyle={animations.backButtonAnimatedStyle}
      bodyProps={{
        availableConditions: routeData.availableConditions,
        colors,
        conditionOffers: purchaseState.conditionOffersForDisplay,
        effectiveComparePrice: purchaseState.effectiveComparePrice,
        effectivePrice: purchaseState.effectivePrice,
        hasMoreReviews: reviewsState.hasMore,
        loadMoreReviews: reviewsState.loadMore,
        onMarkHelpful: (reviewId) => {
          markReviewHelpful(reviewId, product.id).catch((err) =>
            log.error('Failed to mark review helpful:', err)
          );
        },
        onSelectAttribute: selectionHandlers.onSelectAttribute,
        onSelectColor: selectionHandlers.onSelectColor,
        onSelectStorage: selectionHandlers.onSelectStorage,
        product: routeData.displayProduct ?? product,
        reviewStats: reviewsState.stats,
        reviews: reviewsState.reviews,
        reviewsLoading: reviewsState.isLoading,
        selectedAttributes: routeData.effectiveSelectedAttributes,
        selectedColor: routeData.effectiveSelectedColor,
        selectedCondition: routeData.effectiveSelectedCondition,
        selectedStorage: routeData.effectiveSelectedStorage,
        selectedVariant: routeData.selectedVariant,
        setSelectedCondition: selectionHandlers.onSelectCondition,
        setSelectedVariant: selectionHandlers.onSetSelectedVariant,
      }}
      colors={colors}
      flyingParticles={cartActions.flyingParticles}
      galleryProps={{
        colors,
        discountPercentage: getDiscountPercentage(
          purchaseState.effectivePrice,
          purchaseState.effectiveComparePrice
        ),
        headerHeight: animations.headerHeight,
        imageAnimatedStyle: animations.imageAnimatedStyle,
        images: routeData.productGalleryImages,
        selectedImageIndex: routeData.selectedImageIndex,
        setSelectedImageIndex: selectionHandlers.handleSelectImageIndex,
        setShowImageZoom,
        showImageZoom,
      }}
      headerAnimatedStyle={animations.headerAnimatedStyle}
      insets={insets}
      isSaved={isSaved(product.id)}
      onScroll={animations.onScroll}
      onShare={handleShare}
      onWishlistPress={() => {
        const shouldTrackWishlistAdd = !isSaved(product.id);
        toggleSaved(product);
        if (shouldTrackWishlistAdd) {
          void trackProductRouteWishlistAdd(
            product,
            purchaseState.effectivePrice
          );
        }
      }}
      product={product}
      savedToastState={savedToastState}
      showAddedToast={cartActions.showAddedToast}
      stickyProps={{
        canPurchase: purchaseState.canPurchase,
        colors,
        localQty: cartActions.localQty,
        onAddToCart: (event) => cartActions.handleAddToCart(event),
        onDecrement: (event) =>
          cartActions.handleUpdateQuantity(cartState.quantityInCart - 1, event),
        onIncrement: (event) =>
          cartActions.handleUpdateQuantity(cartState.quantityInCart + 1, event),
        onLocalQtyBlur: cartActions.handleLocalQtyBlur,
        onLocalQtyChange: cartActions.handleLocalQtyChange,
        quantityInCart: cartState.quantityInCart,
      }}
    />
  );
}
