import type {
  ProductGridInteractionBindingsValue,
  ProductGridParticle,
} from './ProductGridInteractionBindings';

/**
 * Sole export: the inert pre-activation bindings for the homepage grid.
 * Rendered until the deferred interactive modules (see
 * home-product-grid-interaction-loaders) resolve on first activation.
 */
const NO_PARTICLES: ProductGridParticle[] = [];

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
