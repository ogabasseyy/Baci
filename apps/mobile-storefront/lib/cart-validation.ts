import type { CartItem } from '@/stores/cart-store';

export interface ValidCartStore {
  items: CartItem[];
  itemCount: () => number;
  subtotal: () => number;
  updateQuantity: (itemId: string, quantity: number) => void | Promise<void>;
  removeItem: (itemId: string) => void | Promise<void>;
  clearCart: () => void | Promise<void>;
  toggleAssurance: (itemId: string) => void;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidCartItemShape(item: unknown): item is CartItem {
  if (!item || typeof item !== 'object') {
    return false;
  }

  const cartItem = item as Partial<CartItem>;
  const quantity = cartItem.quantity;
  const hasCoreFields =
    isNonEmptyString(cartItem.id) &&
    isNonEmptyString(cartItem.product_id) &&
    isNonEmptyString(cartItem.slug) &&
    isNonEmptyString(cartItem.name) &&
    isFiniteNumber(cartItem.price) &&
    cartItem.price >= 0 &&
    typeof quantity === 'number' &&
    Number.isInteger(quantity) &&
    quantity > 0;

  if (!hasCoreFields) {
    return false;
  }

  if (
    cartItem.negotiatedPrice !== undefined &&
    (!isFiniteNumber(cartItem.negotiatedPrice) || cartItem.negotiatedPrice <= 0)
  ) {
    return false;
  }

  if (
    cartItem.assuranceRate !== undefined &&
    (!isFiniteNumber(cartItem.assuranceRate) || cartItem.assuranceRate < 0)
  ) {
    return false;
  }

  if (
    cartItem.hasAssurance !== undefined &&
    typeof cartItem.hasAssurance !== 'boolean'
  ) {
    return false;
  }

  return true;
}

export function isValidCartStore(store: unknown): store is ValidCartStore {
  if (!store || typeof store !== 'object') {
    return false;
  }

  const candidate = store as Partial<ValidCartStore>;
  if (!Array.isArray(candidate.items)) {
    return false;
  }

  const hasValidItemShape =
    candidate.items.length === 0 ||
    candidate.items.every((item) => isValidCartItemShape(item));

  return (
    hasValidItemShape &&
    typeof candidate.itemCount === 'function' &&
    typeof candidate.subtotal === 'function' &&
    typeof candidate.updateQuantity === 'function' &&
    typeof candidate.removeItem === 'function' &&
    typeof candidate.clearCart === 'function' &&
    typeof candidate.toggleAssurance === 'function'
  );
}
