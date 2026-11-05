import { createMockCommerce } from '@baci/experience-sdk';
import type {
  BridgeRequest,
  BridgeResult,
  PublicBootstrap,
  RouteState,
} from '@baci/shared/experience';
/** Construct the mock internally: private previews cannot inject a live cart writer. */
export function createPreviewDispatcher(
  bootstrap: PublicBootstrap,
  navigation: {
    go: (path: string, id: string) => Promise<BridgeResult<RouteState>>;
    open: (
      path: string,
      id: string
    ) => Promise<BridgeResult<{ presented: boolean }>>;
  }
) {
  const mock = createMockCommerce(bootstrap);
  return (request: BridgeRequest): Promise<BridgeResult<unknown>> => {
    const args = request.args;
    switch (request.method) {
      case 'catalog.collection':
        return mock.catalog.collection(String(args.handle));
      case 'catalog.product':
        return mock.catalog.product(String(args.handle));
      case 'catalog.variants':
        return mock.catalog.variants(String(args.productId));
      case 'cart.reconcile':
        return mock.cart.reconcile(String(args.operationId)) as Promise<
          BridgeResult<unknown>
        >;
      case 'cart.readPublic':
        return mock.cart.readPublic();
      case 'cart.add':
        return mock.cart.add(
          args as { productId: string; quantity: number }
        ) as Promise<BridgeResult<unknown>>;
      case 'cart.remove':
        return mock.cart.remove(String(args.lineId)) as Promise<
          BridgeResult<unknown>
        >;
      case 'cart.set_quantity':
        return mock.cart.setQuantity(
          String(args.lineId),
          Number(args.quantity)
        ) as Promise<BridgeResult<unknown>>;
      case 'checkout.prepare':
        return mock.checkout.prepare();
      case 'checkout.open':
        return mock.checkout.open();
      case 'navigation.go':
        return navigation.go(String(args.path), request.requestId);
      case 'navigation.open':
        return navigation.open(String(args.path), request.requestId);
    }
  };
}
