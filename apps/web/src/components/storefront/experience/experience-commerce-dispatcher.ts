import type {
  BridgeRequest,
  BridgeResult,
  CartBridgeResult,
} from '@baci/shared/experience';
import { prepareSharedCartCheckout } from '@/hooks/cart/shared-cart-client';
import {
  createExperienceCheckout,
  waitForExperienceCart,
} from '@/lib/experience/commerce-context';
import { createExperienceCartAdapter } from './experience-cart-adapter';
import type { ExperienceHostLive } from './experience-host-runtime';
import { readExperienceCatalog } from './experience-launch-client';
import type { ExperienceShellState } from './experience-shell-controller';

type Admit = () =>
  | { allowed: true }
  | { allowed: false; code: 'STALE_ROUTE' | 'LAUNCH_EXPIRED' };

/** Commerce-only bridge behavior, loaded only for cart and checkout requests. */
export function dispatchExperienceCommerceRequest(
  request: BridgeRequest,
  {
    state,
    live,
    merchantSlug,
    present,
    admit,
    rebind,
    isActive,
    identityMatches,
  }: {
    state: ExperienceShellState;
    live: { current: ExperienceHostLive };
    merchantSlug: string;
    present: () => void;
    admit: Admit;
    rebind: (partition: string) => void;
    isActive: () => Promise<boolean>;
    identityMatches: () => boolean;
  }
): Promise<BridgeResult<unknown> | CartBridgeResult> {
  const c = live.current.cart;
  const port = c?.experienceCommandPort?.withAdmission(
    admit,
    (verified) => {
      if (!admit().allowed) return false;
      rebind(verified);
      return true;
    },
    identityMatches,
    isActive
  );
  const adapter = createExperienceCartAdapter({
    commandPort: port,
    operationId: () => request.requestId,
    readPublicCart: async () => {
      const result = await (c?.experienceCommandPort?.readPublic(
        state.data.bootstrap.currency ??
          state.data.bootstrap.catalog.products[0]?.currency ??
          'NGN'
      ) ??
        Promise.resolve({
          status: 'error' as const,
          code: 'CART_ENROLLMENT_REQUIRED' as const,
          message: 'Use native checkout.',
        }));
      return admit().allowed
        ? result
        : {
            status: 'error',
            code: 'STALE_ROUTE',
            message: 'Use the trusted cart.',
          };
    },
    capabilities: state.data.bootstrap.capabilities,
    catalog: () => state.data.bootstrap.catalog,
    ...(state.data.bootstrap.capabilities.includes('catalog.read')
      ? {
          resolveProduct: async (id) => {
            if (!admit().allowed) return null;
            const catalog = await readExperienceCatalog(state.data.stateUrl, {
              productId: id,
            });
            if (!admit().allowed) return null;
            return (
              catalog.products.find((product) => product.id === id) ?? null
            );
          },
        }
      : {}),
  });
  const checkout = createExperienceCheckout({
    admit: () => admit().allowed,
    settle: () =>
      waitForExperienceCart(
        () => live.current.cart?.syncStatus,
        () => admit().allowed
      ),
    refresh: async () => {
      await live.current.cart?.refreshSharedCart?.();
    },
    prepare: async () => {
      const ref = live.current.cart?.sharedCartRef;
      return ref
        ? await prepareSharedCartCheckout(
            {
              cartId: ref.cartId,
              expectedVersion: ref.version,
              operationId: crypto.randomUUID(),
            },
            merchantSlug
          )
        : { ok: false };
    },
    present: () => present(),
  });

  switch (request.method) {
    case 'cart.reconcile':
      return adapter.reconcile(String(request.args.operationId));
    case 'cart.readPublic':
      return adapter.readPublic();
    case 'cart.add':
      return adapter.add(request.args as never);
    case 'cart.remove':
      return adapter.remove(String(request.args.lineId));
    case 'cart.set_quantity':
      return adapter.setQuantity(
        String(request.args.lineId),
        Number(request.args.quantity)
      );
    case 'checkout.prepare':
      return checkout.prepare();
    case 'checkout.open':
      return checkout.open();
    default:
      return Promise.resolve({
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Use the trusted storefront.',
      });
  }
}
