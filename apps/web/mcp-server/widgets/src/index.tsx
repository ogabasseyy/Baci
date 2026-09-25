import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandLogo } from './brand-logo';
import { getCartHandoffUrl } from './cart-handoff-result';
import { getProductImageUrl } from './product-image';
import { useOpenAiGlobal } from './hooks/use-openai-global';
import { useWidgetState } from './hooks/use-widget-state';

// Types
interface Product {
  id: string;
  name: string;
  slug: string;
  price: number;
  compare_at_price?: number;
  image_url?: string;
  image?: string;
  images?: string[];
  condition?: string;
  stock_level?: string;
  brand?: string;
  category?: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface WidgetState {
  cart: CartItem[];
  cartUrl?: string;
  [key: string]: unknown; // Index signature for type compatibility
}

const createDefaultState = (): WidgetState => ({
  cart: [],
});

// Format price in Naira
const NGN_PRICE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
});

const formatPrice = (price: number): string => {
  return NGN_PRICE_FORMATTER.format(price);
};

// Product Card Component
function ProductCard({
  product,
  isInCart,
  onAddToCart,
}: {
  product: Product;
  isInCart: boolean;
  onAddToCart: (product: Product) => void;
}) {
  const [imageError, setImageError] = useState(false);
  const imageUrl = getProductImageUrl(product);
  const hasDiscount =
    product.compare_at_price && product.compare_at_price > product.price;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.price / product.compare_at_price!) * 100)
    : 0;

  return (
    <div className="product-card">
      <div className="product-image">
        {imageUrl && !imageError ? (
          <img
            src={imageUrl}
            alt={product.name}
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <div className="no-image">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
        {hasDiscount && (
          <span className="badge-discount">-{discountPercent}%</span>
        )}
        {product.condition && product.condition !== 'new' && (
          <span className="badge-condition">{product.condition}</span>
        )}
      </div>
      <div className="product-info">
        <h3 className="product-name">{product.name}</h3>
        <div className="product-price">
          <span className="current-price">{formatPrice(product.price)}</span>
          {hasDiscount && (
            <span className="original-price">
              {formatPrice(product.compare_at_price!)}
            </span>
          )}
        </div>
        {product.stock_level && (
          <span className="stock-badge">{product.stock_level}</span>
        )}
      </div>
      <div className="product-actions">
        <button type="button"
          className={`btn-add-cart ${isInCart ? 'in-cart' : ''}`}
          onClick={() => onAddToCart(product)}
          disabled={isInCart}
        >
          {isInCart ? (
            <>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Link Ready
            </>
          ) : (
            <>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              Prepare Cart Link
            </>
          )}
        </button>
        <button type="button"
          className="btn-buy-now"
          onClick={() => {
            const url = `https://ogabassey.com/products/${encodeURIComponent(product.slug)}`;
            if (window.openai?.openExternal) {
              window.openai.openExternal({ href: url });
            } else {
              window.open(url, '_blank');
            }
          }}
        >
          Review on Ogabassey
        </button>
      </div>
    </div>
  );
}

// Cart Summary Component
function CartSummary({
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

// Main App Component
export function App() {
  const toolOutput = useOpenAiGlobal('toolOutput') as {
    products?: Product[];
  } | null;
  const theme = useOpenAiGlobal('theme') || 'dark';
  const displayMode = useOpenAiGlobal('displayMode') || 'inline';
  const [widgetState, setWidgetState] =
    useWidgetState<WidgetState>(createDefaultState);
  const [cartError, setCartError] = useState<string | null>(null);
  const handoffRequestId = useRef(0);

  const cart = widgetState?.cartUrl ? widgetState.cart : [];
  const products = toolOutput?.products || [];

  useEffect(() => {
    window.openai?.setOpenInAppUrl?.({ href: 'https://ogabassey.com' });
  }, []);

  // Add item to cart
  const handleAddToCart = async (product: Product) => {
    const requestId = ++handoffRequestId.current;
    setCartError(null);
    try {
      const result = await window.openai?.callTool?.('add_to_cart', {
        product_id: product.id,
      });
      const cartUrl = getCartHandoffUrl(result, product.id);
      if (requestId !== handoffRequestId.current) return;
      if (!cartUrl) {
        setCartError('This item is unavailable for cart handoff. Please choose another product.');
        return;
      }
      // The MCP handoff supports one product at a time.
      setWidgetState((prev) => ({
        ...prev!,
        cart: [{ product, quantity: 1 }],
        cartUrl,
      }));
    } catch {
      if (requestId !== handoffRequestId.current) return;
      setCartError('Could not prepare the cart link. Please try again.');
    }
  };

  // Remove item from cart
  const handleRemoveItem = (productId: string) => {
    handoffRequestId.current += 1;
    setWidgetState((prev) => ({
      ...prev!,
      cart: prev?.cart.filter((item) => item.product.id !== productId) || [],
      cartUrl: undefined,
    }));
  };

  // View cart / checkout
  const handleViewCart = () => {
    if (cart.length === 0 || !widgetState?.cartUrl) return;

    if (window.openai?.openExternal) {
      window.openai.openExternal({ href: widgetState.cartUrl });
    } else {
      window.open(widgetState.cartUrl, '_blank');
    }
  };

  return (
    <div className={`ogabassey-widget theme-${theme} ${displayMode === 'fullscreen' ? 'mode-fullscreen' : 'mode-inline'}`}>
      <header className="widget-header">
        <div className="brand">
          <div className="brand-logo"><BrandLogo /></div>
          <div className="brand-text">
            <h1>Ogabassey</h1>
            <p>Premium Tech & Gadgets</p>
          </div>
        </div>
        <div className="header-actions">
        {products.length > 1 && displayMode !== 'fullscreen' && window.openai?.requestDisplayMode && (
          <button type="button" className="expand-button" onClick={() => void window.openai?.requestDisplayMode?.({ mode: 'fullscreen' })}>
            Expand catalog
          </button>
        )}
        {cart.length > 0 && (
          <button type="button" className="cart-badge" onClick={handleViewCart}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span className="cart-badge-count">{cart.length}</span>
          </button>
        )}
        </div>
      </header>

      {cartError && <p role="alert" className="cart-error">{cartError}</p>}

      {products.length > 0 ? (
        <div className={`products-grid ${products.length === 1 ? 'products-grid--single' : ''}`}>
          {products.slice(0, 6).map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isInCart={cart.some((item) => item.product.id === product.id)}
              onAddToCart={handleAddToCart}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <p>Ask me to search for products!</p>
        </div>
      )}

      <CartSummary
        cart={cart}
        onViewCart={handleViewCart}
        onRemoveItem={handleRemoveItem}
      />

      {/* Mobile Sticky Footer */}
      {cart.length > 0 && (
        <div className="mobile-sticky-footer">
          <button type="button"
            className="btn-negotiate-icon"
            onClick={() => {
              window.openai?.sendFollowUpMessage?.(
                { prompt: 'I would like to negotiate the price for my selected item.' }
              );
            }}
            aria-label="Negotiate Price"
            title="Negotiate Price"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              <path d="M8 10h.01" />
              <path d="M12 10h.01" />
              <path d="M16 10h.01" />
            </svg>
          </button>
          <button type="button" className="btn-checkout-sticky" onClick={handleViewCart}>
              Review Cart on Ogabassey →
          </button>
        </div>
      )}

      <footer className="widget-footer">
        <button type="button"
          className="btn-browse-more"
          onClick={() => {
            if (window.openai?.openExternal) {
              window.openai.openExternal({ href: 'https://ogabassey.com' });
            } else {
              window.open('https://ogabassey.com', '_blank');
            }
          }}
        >
          Browse All Products →
        </button>
      </footer>
    </div>
  );
}

// Mount
const rootEl = document.getElementById('ogabassey-root');
if (rootEl) {
  createRoot(rootEl).render(<App />);
}
