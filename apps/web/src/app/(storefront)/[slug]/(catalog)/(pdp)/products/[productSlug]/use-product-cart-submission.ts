import { useCallback } from 'react';
import { useCart } from '@/hooks/cart';
import type { useMerchant } from '@/hooks/use-merchant-client';
import { useToast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/event-tracking';
import type { Product, ProductVariant } from '@/lib/products';
import { resolveSerializedOfferStock } from '@/lib/serialized-offer-stock';
import { resolveSerializedVariantStock } from '@/lib/serialized-variant-stock';
import type { ProductCondition } from './product-selection-condition';

export type ProductOfferSelection = NonNullable<Product['offers']>[number];

export interface ProductCartSubmissionInput {
  product: Product;
  merchant: ReturnType<typeof useMerchant>['merchant'];
  currencyCode: string;
  currentVariantSelection: { variant: ProductVariant } | null;
  selectedOffer: ProductOfferSelection | null;
  selectedCondition: ProductCondition;
  effectiveVariantAttributes: Record<string, string>;
  currentPrice: number;
  quantity: number;
}

/**
 * Builds the PDP add-to-cart handler from the current selection: carries
 * the exact option availability onto the cart line, requires a variant
 * choice for variant products, then tracks and confirms the add.
 */
export function useProductCartSubmission({
  product,
  merchant,
  currencyCode,
  currentVariantSelection,
  selectedOffer,
  selectedCondition,
  effectiveVariantAttributes,
  currentPrice,
  quantity,
}: ProductCartSubmissionInput) {
  const { addToCart, setMerchantSlug } = useCart();
  const { toast } = useToast();

  return useCallback(() => {
    const variantForCart = currentVariantSelection?.variant;
    // The cart guard reads product stock: carry the exact option
    // availability (serialized units or offer quantity) so a stocked
    // selection on a zero-parent-stock product is not silently rejected.
    const selectedOptionStock = variantForCart
      ? (resolveSerializedVariantStock(variantForCart) ??
        variantForCart.stock_quantity ??
        product.stock)
      : selectedOffer
        ? (resolveSerializedOfferStock(selectedOffer, product) ??
          selectedOffer.stock_quantity ??
          product.stock)
        : product.stock;
    const productToAdd =
      variantForCart || selectedOffer
        ? { ...product, price: currentPrice, stock: selectedOptionStock }
        : product;

    // Store merchant slug for checkout
    if (merchant?.slug) {
      setMerchantSlug(merchant.slug);
    }

    if (product.has_variants && !variantForCart) {
      toast({
        title: 'Select a variant',
        description: 'Please select a valid variant before adding this item.',
        variant: 'destructive',
      });
      return;
    }

    addToCart(
      productToAdd,
      quantity,
      variantForCart
        ? {
            condition: selectedCondition,
            variantId: variantForCart.id,
            variantAttributes: effectiveVariantAttributes,
          }
        : selectedOffer
          ? { condition: selectedCondition, offerId: selectedOffer.id }
          : undefined
    );

    // Track add to cart for merchant analytics
    if (merchant?.id) {
      trackEvent.addToCart(merchant.id, productToAdd, quantity, currencyCode);
    }

    const variantInfo = variantForCart
      ? ` (${Object.values(effectiveVariantAttributes).join(', ')})`
      : '';

    toast({
      title: 'Added to cart!',
      description: `${quantity} x ${product.name}${variantInfo} has been added to your cart.`,
    });
  }, [
    addToCart,
    currencyCode,
    currentPrice,
    currentVariantSelection,
    effectiveVariantAttributes,
    merchant,
    product,
    quantity,
    selectedCondition,
    selectedOffer,
    setMerchantSlug,
    toast,
  ]);
}
