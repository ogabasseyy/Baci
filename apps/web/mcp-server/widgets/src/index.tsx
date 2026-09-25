import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandLogo } from './brand-logo';
import { useOpenAiGlobal } from './hooks/use-openai-global';
import { CartSummary } from './cart-summary';
import { ProductCard } from './product-card';
import { useCartHandoff } from './hooks/use-cart-handoff';
import type { Product } from './widget-types';

// Main App Component
export function App() {
  const toolOutput = useOpenAiGlobal('toolOutput') as {
    products?: Product[];
  } | null;
  const theme = useOpenAiGlobal('theme') || 'dark';
  const displayMode = useOpenAiGlobal('displayMode') || 'inline';
  const products = toolOutput?.products || [];
  const {
    cart,
    cartError,
    handleAddToCart,
    handleRemoveItem,
    handleViewCart,
  } = useCartHandoff();

  useEffect(() => {
    window.openai?.setOpenInAppUrl?.({ href: 'https://ogabassey.com' });
  }, []);

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
