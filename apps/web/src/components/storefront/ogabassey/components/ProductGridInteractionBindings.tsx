'use client';

import type React from 'react';
import { useState } from 'react';
import { useCart } from '@/hooks/cart';
import { useV2Saved } from '../providers/v2-saved-context';
import type { Product } from '../types';

export interface ProductGridParticle {
  id: number;
  x: number;
  y: number;
}

export interface ProductGridInteractionBindingsValue {
  isAdded: (productId: number | string) => boolean;
  getCartQuantity: (productId: number | string) => number;
  isWishlisted: (productId: number | string) => boolean;
  onAddToCart: (event: React.MouseEvent, product: Product) => void;
  onToggleWishlist: (event: React.MouseEvent, product: Product) => void;
  particles: ProductGridParticle[];
}

interface ProductGridInteractionBindingsProps {
  children: (bindings: ProductGridInteractionBindingsValue) => React.ReactNode;
}

/**
 * Module-scope so the impure calls (Date.now/Math.random) stay out of the
 * component's render scope; only ever invoked from event handlers.
 */
function createParticleId(): number {
  return Date.now() + Math.random();
}

export function ProductGridInteractionBindings({
  children,
}: ProductGridInteractionBindingsProps) {
  const { addToCart, cart } = useCart();
  const { toggleSaved, isSaved } = useV2Saved();
  const [addedItems, setAddedItems] = useState<Array<number | string>>([]);
  const [particles, setParticles] = useState<ProductGridParticle[]>([]);

  const onAddToCart = (event: React.MouseEvent, product: Product) => {
    event.preventDefault();
    event.stopPropagation();
    if (addToCart(product as never, 1) === 'rejected') {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const particleId = createParticleId();
    setParticles((currentParticles) => [
      ...currentParticles,
      {
        id: particleId,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
    ]);
    setTimeout(() => {
      setParticles((currentParticles) =>
        currentParticles.filter((particle) => particle.id !== particleId)
      );
    }, 1000);

    setAddedItems((currentItems) => [...currentItems, product.id]);
    setTimeout(() => {
      setAddedItems((currentItems) =>
        currentItems.filter((id) => id !== product.id)
      );
    }, 2000);
  };

  const onToggleWishlist = (event: React.MouseEvent, product: Product) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSaved(product);
  };

  return children({
    isAdded: (productId) =>
      addedItems.some((addedItemId) => addedItemId === productId),
    getCartQuantity: (productId) =>
      cart.find((item) => String(item.id) === String(productId))?.quantity || 0,
    isWishlisted: (productId) => isSaved(String(productId)),
    onAddToCart,
    onToggleWishlist,
    particles,
  });
}
