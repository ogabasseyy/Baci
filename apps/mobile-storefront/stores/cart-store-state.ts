import type { CartItem } from './cart-store.types';

export interface CartState {
  // State
  items: CartItem[];
  isLoading: boolean;
  lineSequence: number;
  checkoutGeneration: string;
  // True while a cart-wide (group) negotiation is applied. Removing or
  // re-pricing an item invalidates the proportional group total, so the group
  // negotiation is reset when the cart composition changes.
  cartWideNegotiationActive: boolean;

  // Computed (via getters)
  itemCount: () => number;
  subtotal: () => number;
  totalSavings: () => number;

  // Actions
  addItem: (item: Omit<CartItem, 'id'>) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  getItem: (productId: string, variantId?: string) => CartItem | undefined;
  // Negotiation actions (matches web feature parity)
  applyNegotiatedPrice: (id: string, negotiatedPrice: number) => void;
  applyCartWideNegotiation: (newTotal: number) => void;
  clearNegotiatedPrice: (id: string) => void;
  // Restore actions (for rollback without generating new IDs). The optional
  // cart-wide flag is restored alongside items so a rolled-back group deal does
  // not leave stale per-line negotiated prices behind an inactive flag.
  restoreItems: (
    items: CartItem[],
    cartWideNegotiationActive?: boolean,
    checkoutGeneration?: string
  ) => void;
  // Reconcile stored prices with the live catalog (keyed by cart line id).
  repriceItems: (priceById: Record<string, number>) => void;
  // Device assurance actions
  toggleAssurance: (id: string) => void;
}
