import { formatPrice } from './format-price';
import type { CartItem } from './widget-types';

// Cart Summary Component
export function CartSummary({
  cart,
  onViewCart,
  onRemoveItem,
}: {
  cart: CartItem[];
  onViewCart: () => void;
  onRemoveItem: (productId: string) => void;
}) {
  const total = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (cart.length === 0) return null;

  return (
    <div className="cart-summary">
      <div className="cart-header">
        <span className="cart-count">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
          {itemCount} item{itemCount !== 1 ? 's' : ''}
        </span>
        <span className="cart-total">{formatPrice(total)}</span>
      </div>
      <div className="cart-items">
        {cart.map((item) => (
          <div key={item.product.id} className="cart-item">
            <span className="cart-item-name">{item.product.name}</span>
            <span className="cart-item-qty">×{item.quantity}</span>
            <button type="button"
              className="cart-item-remove"
              onClick={() => onRemoveItem(item.product.id)}
              aria-label={`Remove ${item.product.name}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-checkout" onClick={onViewCart}>
        Review Cart on Ogabassey →
      </button>
    </div>
  );
}
