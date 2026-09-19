import type React from 'react';
import type {
  ProductGridInteractionBindingsValue,
  ProductGridParticle,
} from './ProductGridInteractionBindings';
import type { ProductGridItemProps } from './ProductGridItem';
import type { Product } from '../types';

/**
 * Deferred interactive layer for the homepage grid: the dynamically
 * imported bindings/card modules (module-scope so the dynamic import()
 * expressions stay outside component bodies — React Compiler cannot lower
 * import expressions) plus the inert pre-activation bindings. The chunks
 * load on first grid activation only.
 */
export interface ProductGridInteractionBindingsModule {
  ProductGridInteractionBindings: React.ComponentType<{
    children: (
      bindings: ProductGridInteractionBindingsValue
    ) => React.ReactNode;
  }>;
}

export interface ProductGridItemModule {
  ProductGridItem: React.ComponentType<ProductGridItemProps>;
}

export interface PreviewCatalogModule {
  products: Product[];
}

export const loadDefaultInteractionBindingsModule = () =>
  import('./ProductGridInteractionBindings');

export const loadDefaultInteractiveCardModule = () =>
  import('./ProductGridItem');

const NO_PARTICLES: ProductGridParticle[] = [];

/** Pre-activation bindings: inert until the interactive modules resolve. */
export const STATIC_BINDINGS: ProductGridInteractionBindingsValue = {
  isAdded: () => false,
  getCartQuantity: () => 0,
  isWishlisted: () => false,
  onAddToCart: (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  onToggleWishlist: (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  particles: NO_PARTICLES,
};
