import type React from 'react';
import type { ProductGridInteractionBindingsValue } from './ProductGridInteractionBindings';
import type { ProductGridItemProps } from './ProductGridItem';
import type { Product } from '../types';

/**
 * Sole concern: the deferred interactive modules for the homepage grid.
 * Module-scope so the dynamic import() expressions stay outside component
 * bodies (React Compiler cannot lower import expressions). The chunks
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
