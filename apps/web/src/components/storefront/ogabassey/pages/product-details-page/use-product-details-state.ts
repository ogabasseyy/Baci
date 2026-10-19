'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useMerchantSafe } from '@/hooks/merchant/use-merchant';
import { useToast } from '@/hooks/use-toast';
import { asRoute } from '@/lib/routes';
import { useV2Saved } from '../../providers/v2-saved-context';
import type { Product } from '../../types';
import { createProductCartHandlers } from './product-cart-handlers';
import {
  formatAxisLabel,
  getAxisOptions,
  getDeliveryEstimate,
  getMissingSelectionFields,
} from './product-details-helpers';
import { resolveCurrentOffer } from './offer-resolution';
import { useDeliveryToday } from './use-delivery-today';
import { shareProductLink } from './product-share';
import { useProductDetailsBuyAction } from './use-product-details-buy-action';
import { useProductDetailsCartQuantity } from './use-product-details-cart-quantity';
import { useProductDetailsSelectionState } from './use-product-details-selection-state';

export type ProductDetailsActiveTab =
  | 'compare' | 'description' | 'reviews' | 'specs';

export function useProductDetailsState(serverProduct: Product) {
  const deliveryToday = useDeliveryToday();
  const searchParams = useSearchParams();
  const router = useRouter();
  const merchantContext = useMerchantSafe();
  const { addToCart, applyNegotiatedPrice, cart, removeFromCart, updateQuantity } =
    useCart();
  const { toast } = useToast();
  const { isSaved, toggleSaved } = useV2Saved();
  const checkoutRedirectTimeoutRef = useRef<number | null>(null);

  const basePath = merchantContext?.basePath || '';
  const merchantName =
    merchantContext?.merchant?.business_name || 'Ogabassey';
  const merchantId = merchantContext?.merchant?.id;
  const merchantSlug = merchantContext?.merchant?.slug || '';
  const merchantVatRate =
    merchantContext?.merchant?.vat_registration_status === 'registered'
      ? (merchantContext.merchant.vat_rate ?? 7.5) / 100
      : 0;
  const {
    availableConditions,
    currentCartVariantSelection,
    currentVariantDisplaySelection,
    currentVariantSelection,
    effectiveAxes,
    productData,
    relatedProductsProduct,
    secondaryColor,
    selectedAttributes,
    selectedColor,
    selectedCondition,
    selectedImage,
    routeResolvedVariantSelection,
    setSecondaryColor,
    setSelectedAttributes,
    setSelectedColor,
    setSelectedCondition,
    setSelectedImage,
    variantSelectionAttributes,
  } = useProductDetailsSelectionState(serverProduct, searchParams);

  const [activeTab, setActiveTab] =
    useState<ProductDetailsActiveTab>('description');
  const [deliveryLocation, setDeliveryLocation] = useState<
    'Lagos' | 'Outside Lagos'
  >('Lagos');
  const [isNegotiationOpen, setIsNegotiationOpen] = useState(false);
  const [isSelectionModalOpen, setIsSelectionModalOpen] = useState(false);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [animatingParticles, setAnimatingParticles] = useState<DOMRect[]>([]);

  useProductDetailsBuyAction({
    addToCart,
    basePath,
    checkoutRedirectTimeoutRef,
    productData,
    routeResolvedVariantSelection,
    routerPush: router.push,
    searchParams,
    serverProduct,
    toast,
  });

  const { currentCartItemId, inputValue, quantityInCart, setInputValue } =
    useProductDetailsCartQuantity({
      cart,
      currentVariantId: currentCartVariantSelection?.variant.id,
      productData,
      secondaryColor,
      selectedAttributes,
      selectedColor,
      selectedCondition,
    });

  const currentOffer = resolveCurrentOffer(
    productData,
    selectedCondition,
    variantSelectionAttributes,
    currentVariantDisplaySelection
  );
  const currentCartOffer = resolveCurrentOffer(
    productData,
    selectedCondition,
    variantSelectionAttributes,
    currentCartVariantSelection
  );
  const managesStock = productData.manage_stock !== false;
  const canPurchase =
    (productData.variants?.length ?? 0) > 0
      ? Boolean(currentVariantSelection) &&
        (!managesStock || currentCartOffer.stock > 0)
      : !managesStock || currentOffer.stock > 0;

  const normalizedReviewRating = Math.max(
    0,
    Math.min(Number(productData.rating) || 0, 5)
  );
  const normalizedReviewRatingWidth = `${(normalizedReviewRating / 5) * 100}%`;

  const isLiked = isSaved(productData.id);
  const cartHref = asRoute(basePath ? `${basePath}/cart` : '/cart');
  const homeHref = asRoute(basePath || '');

  const triggerFlyToCart = (startRect: DOMRect) => {
    setAnimatingParticles((prev) => [...prev, startRect]);
  };

  const handleAnimationComplete = () => {
    setAnimatingParticles((prev) => prev.slice(1));
  };

  const handleQuantityChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setInputValue(value);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      (event.target as HTMLInputElement).blur();
    }
  };

  const handleColorSelection = (index: number) => {
    if (selectedColor === index) {
      setSelectedColor(null);
      setSecondaryColor(null);
      return;
    }

    setSelectedColor(index);
    if (secondaryColor === index) {
      setSecondaryColor(null);
    }

    const colorName = productData.colors[index]?.name;
    const colorImage = colorName ? productData.colorImages[colorName]?.[0] : undefined;
    if (colorImage) {
      const imageIndex = productData.images.findIndex((image) => image === colorImage);
      setSelectedImage(imageIndex >= 0 ? imageIndex : 0);
      return;
    }

    setSelectedImage(index < productData.images.length ? index : 0);
  };

  const handleColorDoubleClick = (index: number) => {
    if (selectedColor === null) {
      return;
    }
    if (secondaryColor === index) {
      setSecondaryColor(null);
    } else if (selectedColor !== index) {
      setSecondaryColor(index);
    }
  };

  const getMissingFields = () =>
    getMissingSelectionFields(
      productData,
      effectiveAxes,
      selectedColor,
      selectedAttributes
    );

  const handleToggleSaved = () => {
    toggleSaved(serverProduct);
  };

  const handleShare = async () => {
    await shareProductLink({
      merchantName,
      productName: productData.name,
      toast,
      url: window.location.href,
    });
  };

  const {
    handleDecrement,
    handleIncrement,
    handleMobileAddToCart,
    handleNegotiationSuccess,
    handleQuantityBlur,
    validateAndAddToCart,
  } = createProductCartHandlers({
    addToCart,
    applyNegotiatedPrice,
    currentCartItemId,
    currentOffer: currentCartOffer,
    getMissingFields,
    inputValue,
    productData,
    quantityInCart,
    removeFromCart,
    secondaryColor,
    selectedAttributes,
    selectedColor,
    selectedCondition,
    selectedImage,
    selectedVariantId: currentCartVariantSelection?.variant.id,
    canPurchase,
    setInputValue,
    setIsNegotiationOpen,
    setIsSelectionModalOpen,
    setMissingFields,
    toast,
    triggerFlyToCart,
    updateQuantity,
  });

  return {
    activeTab,
    availableConditions,
    animatingParticles,
    basePath,
    canPurchase,
    cartHref,
    currentOffer,
    currentVariantDisplaySelection,
    deliveryEstimate: getDeliveryEstimate(deliveryLocation, deliveryToday),
    deliveryLocation,
    effectiveAxes,
    formatAxisLabel,
    getAxisOptions: (axis: string) => getAxisOptions(axis, productData),
    handleAnimationComplete,
    handleColorDoubleClick,
    handleColorSelection,
    handleDecrement,
    handleIncrement,
    handleKeyDown,
    handleMobileAddToCart,
    handleNegotiationSuccess,
    handleQuantityBlur,
    handleQuantityChange,
    handleShare,
    handleToggleSaved,
    homeHref,
    inputValue,
    isLiked,
    isNegotiationOpen,
    isSelectionModalOpen,
    merchantId,
    merchantSlug,
    merchantVatRate,
    missingFields,
    normalizedReviewRatingWidth,
    productData,
    quantityInCart,
    relatedProductsProduct,
    secondaryColor,
    selectedAttributes,
    selectedColor,
    selectedCondition,
    selectedImage,
    setActiveTab,
    setDeliveryLocation,
    setIsNegotiationOpen,
    setIsSelectionModalOpen,
    setMissingFields,
    setSelectedAttributes,
    setSelectedColor,
    setSelectedCondition,
    setSelectedImage,
    showColorToast: false,
    validateAndAddToCart,
    variantSelectionAttributes,
  };
}
