import { useState } from 'react';
import { getProductImageUrl } from './product-image';
import { formatPrice } from './format-price';
import type { Product } from './widget-types';

// Product Card Component
export function ProductCard({
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
              Prepare Shopping Link
            </>
          )}
        </button>
        <button type="button"
          className="btn-buy-now"
          onClick={() => {
            const url = `https://ogabassey.com/products/${encodeURIComponent(product.slug || product.id)}`;
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
