'use client';

import { resolveDefaultVariantSelection } from '@baci/shared/lib';
import { Check, Minus, Plus, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ThemedBadge, ThemedButton } from '@/components/themed';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCart } from '@/hooks/use-cart';
import { useCurrency } from '@/hooks/use-currency';
import { useToast } from '@/hooks/use-toast';
import type { Product, ProductVariant } from '@/lib/products';
import { cn } from '@/lib/utils';
import { QuickViewDetailsLink } from './quick-view-details-link';

interface QuickViewModalProps {
  /** Product to display */
  product: Product | null;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Merchant slug for checkout context */
  merchantSlug?: string;
  /** Routing prefix; empty for merchant domains and subdomains. */
  basePath?: string;
}

/**
 * Quick View Modal Component
 *
 * Allows customers to quickly preview product details and add to cart
 * without navigating to the full product page. Shows on desktop only.
 *
 * Features:
 * - Image gallery with thumbnails
 * - Variant selection (color, size, etc.)
 * - Quantity selector
 * - Add to cart functionality
 * - Link to full product page
 */
export function QuickViewModal({
  product,
  isOpen,
  onClose,
  merchantSlug,
  basePath = '',
}: QuickViewModalProps) {
  const { formatCurrency } = useCurrency();
  const { addToCart, setMerchantSlug } = useCart();
  const { toast } = useToast();

  const [quantity, setQuantity] = useState(
    () => getDefaultSelectionState(product).quantity
  );
  const [selectedImage, setSelectedImage] = useState<string>(
    () => getDefaultSelectionState(product).selectedImage
  );
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    () => getDefaultSelectionState(product).selectedVariant
  );
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >(() => getDefaultSelectionState(product).selectedAttributes);

  // Reset selection state during render (prev-prop comparison) when the
  // product changes, so the new product's defaults are visible on its very
  // first frame instead of one commit later via an effect.
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevProduct, setPrevProduct] = useState(product);
  if (product !== prevProduct) {
    setPrevProduct(product);
    if (product) {
      const defaults = getDefaultSelectionState(product);
      setQuantity(defaults.quantity);
      setSelectedImage(defaults.selectedImage);
      setSelectedVariant(defaults.selectedVariant);
      setSelectedAttributes(defaults.selectedAttributes);
    }
  }

  if (!product) return null;

  // Get all unique attribute types and values
  const attributeOptions = getAttributeOptions(product.variants || []);

  // Get current price (variant price override or base price)
  const currentPrice = selectedVariant?.price_override ?? product.price;
  const currentStock = selectedVariant?.stock_quantity ?? product.stock;
  const isOutOfStock = product.manage_stock && currentStock === 0;

  const handleAttributeChange = (attributeKey: string, value: string) => {
    const newAttributes = { ...selectedAttributes, [attributeKey]: value };
    setSelectedAttributes(newAttributes);

    // Find matching variant
    if (product.variants) {
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
      }
    }
  };

  const handleQuantityChange = (newQuantity: number) => {
    const moq = product.minimum_order_quantity || 1;
    if (newQuantity >= moq) {
      setQuantity(newQuantity);
    } else {
      setQuantity(moq);
    }
  };

  const handleAddToCart = () => {
    // Store merchant slug for checkout
    if (merchantSlug) {
      setMerchantSlug(merchantSlug);
    }

    // Create a product object with variant info if applicable
    addToCart(
      product,
      quantity,
      selectedVariant
        ? {
            variantId: selectedVariant.id,
            variantAttributes: selectedAttributes,
            storage: selectedAttributes.storage,
            color: selectedAttributes.color,
          }
        : undefined
    );
    toast({
      title: 'Added to cart',
      description: `${quantity} x ${product.name} has been added to your cart.`,
    });
    onClose();
  };

  // Get all images (main + additional)
  const allImages = [
    {
      key: `primary-${product.imageLarge || product.image}`,
      url: product.imageLarge || product.image,
      alt: product.name,
    },
    ...(product.images || []).map((img) => ({
      ...img,
      key: `additional-${img.order}-${img.url}`,
    })),
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <div className="grid md:grid-cols-2 gap-0">
          {/* Image Section */}
          <div className="p-6 bg-muted/30">
            <div className="aspect-square relative rounded-lg overflow-hidden bg-white">
              <Image
                src={selectedImage}
                alt={product.name}
                fill
                className="object-contain"
                priority
                sizes="(min-width: 768px) 50vw, 100vw"
              />
              {product.compare_at_price &&
                product.compare_at_price > currentPrice && (
                  <span className="absolute top-3 left-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-md shadow-sm">
                    SALE
                  </span>
                )}
            </div>

            {/* Thumbnail Gallery */}
            {allImages.length > 1 && (
              <ul className="flex gap-2 mt-4 overflow-x-auto pb-2 list-none m-0 p-0">
                {allImages.map((img, idx) => (
                  <li key={img.key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedImage(img.url)}
                      className={cn(
                        'relative w-16 h-16 rounded-md overflow-hidden border-2 transition-all',
                        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        selectedImage === img.url
                          ? 'border-store-primary'
                          : 'border-transparent hover:border-muted-foreground/30'
                      )}
                      aria-label={`View image ${idx + 1} of ${allImages.length}`}
                      aria-current={
                        selectedImage === img.url ? 'true' : undefined
                      }
                    >
                      <Image
                        src={img.url}
                        alt={img.alt || `Product image ${idx + 1}`}
                        fill
                        className="object-cover"
                        sizes="64px"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Product Details Section */}
          <div className="p-6 flex flex-col">
            <DialogHeader className="text-left mb-4">
              <DialogTitle
                className="text-2xl font-bold"
                style={{ color: 'var(--store-primary)' }}
              >
                {product.name}
              </DialogTitle>
              {product.sku && (
                <p className="text-sm text-muted-foreground">
                  SKU: {product.sku}
                </p>
              )}
            </DialogHeader>

            {/* Price */}
            <div className="flex items-baseline gap-3 mb-4">
              <span
                className="text-2xl font-bold"
                style={{ color: 'var(--store-secondary)' }}
              >
                {formatCurrency(currentPrice)}
              </span>
              {product.compare_at_price &&
                product.compare_at_price > currentPrice && (
                  <span className="text-lg text-muted-foreground line-through">
                    {formatCurrency(product.compare_at_price)}
                  </span>
                )}
            </div>

            {/* Description */}
            <p className="text-muted-foreground mb-6 line-clamp-3">
              {product.description}
            </p>

            {/* Variant Selection */}
            {product.has_variants && attributeOptions.length > 0 && (
              <div className="space-y-4 mb-6">
                {attributeOptions.map(({ key, values }, idx) => {
                  // Sanitize key for valid HTML id (lowercase, alphanumeric + hyphens only)
                  // Include index for guaranteed uniqueness even if keys differ only in special chars
                  const labelId = `variant-label-${idx}-${key
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')}`;
                  return (
                    <div key={key}>
                      <Label
                        className="text-sm font-medium mb-2 block capitalize"
                        id={labelId}
                      >
                        {key}:{' '}
                        <span className="font-normal">
                          {selectedAttributes[key]}
                        </span>
                      </Label>
                      <div
                        className="flex flex-wrap gap-2"
                        role="radiogroup"
                        aria-labelledby={labelId}
                      >
                        {values.map((value) => {
                          const isSelected = selectedAttributes[key] === value;
                          // Check if this option is available
                          const isAvailable = isVariantAvailable(
                            product.variants || [],
                            { ...selectedAttributes, [key]: value },
                            product.manage_stock
                          );

                          return (
                            // biome-ignore lint/a11y/useSemanticElements: Custom styled radio buttons for better visual design
                            <button
                              type="button"
                              key={value}
                              onClick={() => handleAttributeChange(key, value)}
                              disabled={!isAvailable}
                              role="radio"
                              aria-checked={isSelected}
                              aria-label={`${key}: ${value}`}
                              tabIndex={isSelected ? 0 : -1}
                              onKeyDown={(event) => {
                                const keys = [
                                  'ArrowRight',
                                  'ArrowDown',
                                  'ArrowLeft',
                                  'ArrowUp',
                                  'Home',
                                  'End',
                                ];
                                if (!keys.includes(event.key)) return;
                                event.preventDefault();
                                const buttons = Array.from(
                                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                    '[role="radio"]'
                                  ) ?? []
                                );
                                const currentIndex = buttons.indexOf(
                                  event.currentTarget
                                );
                                if (currentIndex < 0) return;
                                const lastIndex = buttons.length - 1;

                                const isForward =
                                  event.key === 'ArrowRight' ||
                                  event.key === 'ArrowDown' ||
                                  event.key === 'Home';

                                let nextIndex =
                                  event.key === 'Home'
                                    ? 0
                                    : event.key === 'End'
                                      ? lastIndex
                                      : (currentIndex +
                                          (isForward ? 1 : -1) +
                                          buttons.length) %
                                        buttons.length;

                                // ARIA APG Radio Group Pattern: Skip disabled options during keyboard navigation
                                let attempts = 0;
                                while (
                                  buttons[nextIndex]?.disabled &&
                                  attempts < buttons.length
                                ) {
                                  nextIndex =
                                    (nextIndex +
                                      (isForward ? 1 : -1) +
                                      buttons.length) %
                                    buttons.length;
                                  attempts += 1;
                                }

                                if (buttons[nextIndex]?.disabled) return;

                                const nextValue = values[nextIndex];
                                handleAttributeChange(key, nextValue);
                                // Focus the next button in the set
                                buttons[nextIndex]?.focus();
                              }}
                              className={cn(
                                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                isSelected
                                  ? 'bg-store-primary text-store-primary-text ring-2 ring-store-primary ring-offset-2'
                                  : isAvailable
                                    ? 'bg-muted hover:bg-muted/80'
                                    : 'bg-muted/50 text-muted-foreground/50 cursor-not-allowed line-through'
                              )}
                            >
                              {isSelected && (
                                <Check
                                  className="size-3 inline mr-1"
                                  aria-hidden="true"
                                />
                              )}
                              {value}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Stock Status */}
            <div className="mb-4">
              {isOutOfStock ? (
                <ThemedBadge colorRole="primary" variant="destructive">
                  Out of Stock
                </ThemedBadge>
              ) : (
                <ThemedBadge colorRole="primary" variant="outline">
                  In Stock
                </ThemedBadge>
              )}
              {product.manage_stock &&
                currentStock > 0 &&
                currentStock <= (product.low_stock_threshold ?? 5) && (
                  <span className="ml-2 text-sm text-amber-600">
                    Only {currentStock} left
                  </span>
                )}
            </div>

            {/* Quantity and Add to Cart */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center">
                <ThemedButton
                  colorRole="accent"
                  size="icon"
                  variant="outline"
                  className="size-10 rounded-r-none"
                  onClick={() => handleQuantityChange(quantity - 1)}
                  disabled={quantity <= (product.minimum_order_quantity || 1)}
                  aria-label="Decrease quantity"
                >
                  <Minus className="size-4" />
                </ThemedButton>
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) =>
                    handleQuantityChange(
                      Number.parseInt(e.target.value, 10) || 1
                    )
                  }
                  className="h-10 w-16 text-center rounded-none border-x-0 remove-arrow"
                  min={product.minimum_order_quantity || 1}
                  aria-label="Quantity"
                />
                <ThemedButton
                  colorRole="accent"
                  size="icon"
                  variant="outline"
                  className="size-10 rounded-l-none"
                  onClick={() => handleQuantityChange(quantity + 1)}
                  aria-label="Increase quantity"
                >
                  <Plus className="size-4" />
                </ThemedButton>
              </div>
              <ThemedButton
                colorRole="primary"
                size="lg"
                className="flex-1"
                onClick={handleAddToCart}
                disabled={isOutOfStock}
              >
                Add to Cart
              </ThemedButton>
            </div>

            {/* Link to Full Product Page */}
            <QuickViewDetailsLink
              product={product}
              basePath={basePath}
              onClose={onClose}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface QuickViewSelectionState {
  quantity: number;
  selectedImage: string;
  selectedVariant: ProductVariant | null;
  selectedAttributes: Record<string, string>;
}

/**
 * Compute the default quick-view selection for a product: minimum order
 * quantity, the default variant (when one resolves), its attributes, and the
 * image to feature (variant primary image, falling back to the product image).
 */
function getDefaultSelectionState(
  product: Product | null
): QuickViewSelectionState {
  if (!product) {
    return {
      quantity: 1,
      selectedImage: '',
      selectedVariant: null,
      selectedAttributes: {},
    };
  }

  const defaultVariantSelection = resolveDefaultVariantSelection(product);
  return {
    quantity: product.minimum_order_quantity || 1,
    selectedImage:
      defaultVariantSelection?.variant.primary_image ||
      product.imageLarge ||
      product.image,
    selectedVariant: defaultVariantSelection?.variant ?? null,
    selectedAttributes: defaultVariantSelection?.attributes ?? {},
  };
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

/**
 * Check if a variant with given attributes exists and has stock.
 * If manage_stock is false/null, all matching variants are available.
 */
function isVariantAvailable(
  variants: ProductVariant[],
  partialAttributes: Record<string, string>,
  manageStock?: boolean
): boolean {
  return variants.some((variant) => {
    const matches = Object.entries(partialAttributes).every(
      ([key, value]) => variant.attributes[key] === value
    );
    return matches && (!manageStock || variant.stock_quantity > 0);
  });
}

/**
 * Hook to manage quick view state.
 * Uses useRef + useEffect cleanup to prevent setTimeout memory leaks.
 */
export function useQuickView() {
  const [product, setProduct] = useState<Product | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const openQuickView = (p: Product) => {
    // Clear any pending timeout from previous close
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setProduct(p);
    setIsOpen(true);
  };

  const closeQuickView = () => {
    setIsOpen(false);
    // Delay clearing product to allow close animation
    timeoutRef.current = setTimeout(() => {
      setProduct(null);
      timeoutRef.current = null;
    }, 300);
  };

  return {
    product,
    isOpen,
    openQuickView,
    closeQuickView,
  };
}
