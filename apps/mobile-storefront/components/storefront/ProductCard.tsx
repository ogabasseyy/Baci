import {
  requiresProductSelection,
  resolveDefaultVariantSelection,
} from '@baci/shared/lib';
import { router } from 'expo-router';
import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { SPRING_CONFIG } from '@/constants/Colors';
import { useHaptics } from '@/hooks/use-haptics';
import { resolveCartItemImageUrl } from '@/lib/cart-display';
import {
  getProductCardImageAttempt,
  normalizeProductImages,
} from '@/lib/product-normalization';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';
import { selectCartQuantities, useCartStore } from '@/stores/cart-store';
import { selectSavedProductIds, useSavedStore } from '@/stores/saved-store';
import type { Product } from '@/types/product';
import EditorialProductCard from './product-card/EditorialProductCard';
import GridProductCard from './product-card/GridProductCard';
import ListProductCard from './product-card/ListProductCard';
import { trackCartAdd, trackWishlistAdd } from './product-card-tracking';

const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*';

export const BLURHASH_VARIANTS = {
  default: 'L6PZfSi_.AyE_3t7t7RjE1%MWBR*',
  electronics: 'L5H2EC=PM+yV0g-mq.wG9c010J}I',
  fashion: 'L8N]~R9G.TtQ~B9at7WC02M{9aIA',
  food: 'L9Ry;S~V.A-;~W9uM{IURiE2E3s:',
  beauty: 'LBP?syt7~pt7~WofM{fQ~ps:9ZWB',
} as const;

interface ProductCardProps {
  product: Product;
  variant?: 'grid' | 'editorial' | 'list';
  onPress?: () => void;
  onPressIn?: () => void;
  onWishlistToggle?: (product: Product) => void;
  blurhash?: string;
}

export function ProductCard({
  product,
  variant = 'grid',
  onPress,
  onPressIn,
  onWishlistToggle,
  blurhash = DEFAULT_BLURHASH,
}: ProductCardProps) {
  const { width: screenWidth } = useWindowDimensions();
  const gridWidth = (screenWidth - 48) / 2;

  const scale = useSharedValue(1);
  const heartScale = useSharedValue(1);
  const addItem = useCartStore((state) => state.addItem);
  const toggleSaved = useSavedStore((state) => state.toggleSaved);

  // O(1) per-card lookups via memoized derived selectors; still return a
  // primitive so a store change for one product never re-renders the others.
  const isSaved = useSavedStore((state) =>
    selectSavedProductIds(state).has(String(product.id))
  );

  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const haptics = useHaptics();

  const cartItemCount = useCartStore(
    (state) => selectCartQuantities(state).get(String(product.id)) ?? 0
  );
  const defaultVariantSelection = resolveDefaultVariantSelection(product);
  const requiresSelection = requiresProductSelection(product);
  const displayProduct =
    product.has_variants && defaultVariantSelection
      ? {
          ...product,
          price: defaultVariantSelection.price,
          compare_at_price: defaultVariantSelection.compareAtPrice,
        }
      : product;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  const heartAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.get() }],
  }));

  const handlePress = () => {
    if (!product.slug) return;

    if (onPress) {
      onPress();
    } else {
      router.push(`/product/${product.slug}`);
    }
  };

  const handleAnimateIn = () => {
    scale.set(withSpring(0.96, SPRING_CONFIG.snappy));
    onPressIn?.();
  };

  const handleAnimateOut = () => {
    scale.set(withSpring(1, SPRING_CONFIG.snappy));
  };

  const handleWishlistPress = () => {
    heartScale.set(
      withSpring(1.3, SPRING_CONFIG.snappy, () => {
        heartScale.set(withSpring(1, SPRING_CONFIG.snappy));
      })
    );

    const shouldTrackWishlistAdd = !isSaved;
    toggleSaved(product);
    if (shouldTrackWishlistAdd) {
      trackWishlistAdd(product);
    }
    onWishlistToggle?.(product);
  };

  const imageCandidates = normalizeProductImages(
    product.image
      ? [
          product.image,
          ...(Array.isArray(product.images) ? product.images : []),
        ]
      : product.images
  );
  const imageCandidatesKey = imageCandidates.join('|');
  const [imageAttempt, setImageAttempt] = useState(0);
  const [showLocalPlaceholder, setShowLocalPlaceholder] = useState(false);

  // FlashList recycles card instances, so reset the image-fallback state when
  // the product (its image set) changes — otherwise a recycled card would show
  // the previous product's placeholder/attempt. (Render-time adjustment, not an
  // effect, so it lands before paint without a flash.)
  const [prevImageCandidatesKey, setPrevImageCandidatesKey] =
    useState(imageCandidatesKey);
  if (prevImageCandidatesKey !== imageCandidatesKey) {
    setPrevImageCandidatesKey(imageCandidatesKey);
    setImageAttempt(0);
    setShowLocalPlaceholder(false);
  }

  const imageProps = {
    placeholder: { blurhash },
    transition: 300,
    cachePolicy: 'memory-disk' as const,
    contentFit: 'cover' as const,
    recyclingKey: product.id,
    allowDownscaling: true,
    enforceEarlyResizing: true,
    autoplay: false,
    onError: () => {
      if (imageAttempt < imageCandidates.length) {
        setImageAttempt((current) => current + 1);
        return;
      }

      setShowLocalPlaceholder(true);
    },
  };

  const imageWidth =
    variant === 'list'
      ? 100
      : variant === 'editorial'
        ? screenWidth - 32
        : gridWidth;
  const imageAttemptUri = getProductCardImageAttempt(
    imageCandidates,
    imageAttempt
  );
  const imageSource = createSafeBoundedImageSource({
    fit: 'cover',
    height: variant === 'editorial' ? imageWidth / 0.8 : imageWidth,
    uri: imageAttemptUri,
    width: imageWidth,
  });
  const quickAddImageUrl = resolveCartItemImageUrl({
    // Persist the source asset, not the card's cover-cropped display transform.
    // Cart and order surfaces apply their own bounded dimensions.
    displayedImageUrl: imageAttemptUri,
    variantImageUrl: defaultVariantSelection?.variant.image,
    variantImages: defaultVariantSelection?.variant.images,
    fallbackImageUrl: product.image,
  });

  const handleAddToCart = () => {
    if (requiresSelection) {
      router.push(`/product/${product.slug}`);
      return;
    }

    if (product.has_variants && !defaultVariantSelection) {
      router.push(`/product/${product.slug}`);
      return;
    }

    haptics.light();

    addItem({
      product_id: product.id,
      slug: product.slug,
      name: product.name,
      variant_id: defaultVariantSelection?.variant.id,
      variant_attributes:
        defaultVariantSelection &&
        Object.keys(defaultVariantSelection.attributes).length > 0
          ? defaultVariantSelection.attributes
          : undefined,
      price: defaultVariantSelection?.price ?? product.price,
      compare_at_price:
        defaultVariantSelection?.compareAtPrice ?? product.compare_at_price,
      quantity: 1,
      image_url: quickAddImageUrl,
      condition: product.condition,
      color: defaultVariantSelection?.color,
      storage: defaultVariantSelection?.storage,
      variant_name: defaultVariantSelection?.variant.name,
    });
    trackCartAdd(product, defaultVariantSelection?.price ?? product.price);
  };

  if (variant === 'editorial') {
    return (
      <EditorialProductCard
        product={displayProduct}
        imageSource={imageSource}
        imageProps={imageProps}
        showLocalPlaceholder={showLocalPlaceholder}
        handlePress={handlePress}
        handleAnimateIn={handleAnimateIn}
        handleAnimateOut={handleAnimateOut}
        handleWishlistPress={handleWishlistPress}
        handleAddToCart={handleAddToCart}
        isSaved={isSaved}
        cartItemCount={cartItemCount}
        animatedStyle={animatedStyle}
        heartAnimatedStyle={heartAnimatedStyle}
        textColor={colors.text}
        screenWidth={screenWidth}
      />
    );
  }

  if (variant === 'list') {
    return (
      <ListProductCard
        product={displayProduct}
        imageSource={imageSource}
        imageProps={imageProps}
        showLocalPlaceholder={showLocalPlaceholder}
        handlePress={handlePress}
        handleAnimateIn={handleAnimateIn}
        handleAnimateOut={handleAnimateOut}
        handleWishlistPress={handleWishlistPress}
        handleAddToCart={handleAddToCart}
        isSaved={isSaved}
        cartItemCount={cartItemCount}
        animatedStyle={animatedStyle}
        heartAnimatedStyle={heartAnimatedStyle}
        colors={colors}
      />
    );
  }

  return (
    <GridProductCard
      product={displayProduct}
      imageSource={imageSource}
      imageProps={imageProps}
      showLocalPlaceholder={showLocalPlaceholder}
      handlePress={handlePress}
      handleAnimateIn={handleAnimateIn}
      handleAnimateOut={handleAnimateOut}
      handleWishlistPress={handleWishlistPress}
      handleAddToCart={handleAddToCart}
      isSaved={isSaved}
      cartItemCount={cartItemCount}
      animatedStyle={animatedStyle}
      heartAnimatedStyle={heartAnimatedStyle}
      gridWidth={gridWidth}
      shadowColor={colors.black}
      colors={colors}
    />
  );
}
