import type { Product } from '@/lib/products';

export interface CartItem extends Product {
  quantity: number;
  variantId?: string;
  variantAttributes?: Record<string, string>;
  cartItemId: string;
  selectedColor?: string;
  selectedColorValue?: string;
  secondaryColor?: string;
  secondaryColorValue?: string;
  selectedStorage?: string;
  condition?: 'new' | 'used' | 'open_box' | 'refurbished';
  negotiatedPrice?: number;
  negotiationStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
  cartDiscount?: number;
  quizAwardId?: string;
  quizVoucherToken?: string;
  hasAssurance?: boolean;
  assuranceRate?: number;
}

export interface AddToCartOptions {
  variantId?: string;
  variantAttributes?: Record<string, string>;
  color?: string;
  colorValue?: string;
  secondaryColor?: string;
  secondaryColorValue?: string;
  storage?: string;
  condition?: string;
  quizAwardId?: string;
  quizVoucherToken?: string;
  platform?: string;
  hasAssurance?: boolean;
  [key: string]: string | boolean | Record<string, string> | undefined;
}

export interface CartContextType {
  cart: CartItem[];
  merchantSlug: string | null;
  addToCart: (
    product: Product,
    quantity?: number,
    options?: AddToCartOptions
  ) => void;
  removeFromCart: (cartItemIdOrProductId: string, variantId?: string) => void;
  updateQuantity: (
    cartItemIdOrProductId: string,
    quantity: number,
    variantId?: string
  ) => void;
  clearCart: () => void;
  setMerchantSlug: (slug: string) => void;
  cartCount: number;
  cartTotal: number;
  totalItems: number;
  subtotal: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  applyNegotiatedPrice?: (cartItemId: string, newPrice: number) => void;
  applyCartWideNegotiation?: (newTotal: number) => void;
  clearNegotiatedPrice?: (cartItemId: string) => void;
  /** True while a cart-wide (group) negotiation is applied. */
  cartWideNegotiationActive?: boolean;
  toggleAssurance?: (cartItemId: string) => void;
  lastAddedProduct: Product | null;
  showUpsell: boolean;
  dismissUpsell: () => void;
  hasSmartCartPro: boolean;
  isHydrated: boolean;
}
