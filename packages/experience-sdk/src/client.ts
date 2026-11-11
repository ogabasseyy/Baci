import type {
  BridgeResult,
  CartBridgeResult,
  ExperienceCommerce,
  ExperienceMethod,
  PublicCart,
  PublicCatalog,
  PublicProduct,
  RouteState,
} from '@baci/shared/experience';
export type CommerceTransport = (
  method: ExperienceMethod,
  args: Record<string, unknown>
) => Promise<BridgeResult<unknown> | CartBridgeResult>;
/** Browser-only facade. Host policy, never caller method strings, grants authority. */
export function createCommerceClient(
  send: CommerceTransport
): ExperienceCommerce {
  const call = <T>(method: ExperienceMethod, args: Record<string, unknown>) =>
    send(method, args) as Promise<BridgeResult<T>>;
  return {
    catalog: {
      collection: (handle) =>
        call<PublicCatalog>('catalog.collection', { handle }),
      product: (handle) => call<PublicProduct>('catalog.product', { handle }),
      variants: (productId) =>
        call<PublicProduct['variants']>('catalog.variants', { productId }),
    },
    cart: {
      reconcile: (operationId) =>
        send('cart.reconcile', { operationId }) as Promise<CartBridgeResult>,
      readPublic: () => call<PublicCart>('cart.readPublic', {}),
      add: (input) => send('cart.add', input) as Promise<CartBridgeResult>,
      remove: (lineId) =>
        send('cart.remove', { lineId }) as Promise<CartBridgeResult>,
      setQuantity: (lineId, quantity) =>
        send('cart.set_quantity', {
          lineId,
          quantity,
        }) as Promise<CartBridgeResult>,
    },
    checkout: {
      prepare: () => call('checkout.prepare', {}),
      open: () => call('checkout.open', {}),
    },
    navigation: {
      go: (path) => call<RouteState>('navigation.go', { path }),
      open: (path) => call('navigation.open', { path }),
    },
  };
}
