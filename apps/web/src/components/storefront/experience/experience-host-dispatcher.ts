import type {
  BridgeRequest,
  BridgeResult,
  CartBridgeResult,
} from '@baci/shared/experience';
import { getLiveCustomerIdentity } from '@/contexts/customer-live-identity';
import type { PublishedExperienceFrameHost } from './experience-frame-types';
import type { ExperienceHostLive } from './experience-host-runtime';
import { readExperienceCatalog } from './experience-launch-client';
import type { ExperienceShellState } from './experience-shell-controller';

const isCommerceRequest = (request: BridgeRequest) =>
  request.method.startsWith('cart.') || request.method.startsWith('checkout.');

const staleRoute = (): BridgeResult<unknown> => ({
  status: 'error',
  code: 'STALE_ROUTE',
  message: 'Continue in the native store.',
});

export function createExperienceHostDispatcher({
  current,
  host,
  live,
  isActive,
  rebind,
  merchantSlug,
  present,
}: {
  current: () => ExperienceShellState;
  host: PublishedExperienceFrameHost;
  live: { current: ExperienceHostLive };
  isActive: () => Promise<boolean>;
  rebind: (partition: string) => void;
  merchantSlug: string;
  present: () => void;
}) {
  return async (
    request: BridgeRequest
  ): Promise<BridgeResult<unknown> | CartBridgeResult> => {
    const s = current();
    const original = host.current();
    const identity = JSON.stringify(getLiveCustomerIdentity());
    const admit = () => {
      try {
        const now = host.current();
        return now.active &&
          !now.transition &&
          now.generation === original.generation &&
          now.route.epoch === original.route.epoch &&
          now.binding.buildDigest === original.binding.buildDigest &&
          now.binding.instanceId === original.binding.instanceId &&
          now.revision === original.revision &&
          now.binding.shopperPartition === original.binding.shopperPartition &&
          JSON.stringify(getLiveCustomerIdentity()) === identity
          ? { allowed: true as const }
          : { allowed: false as const, code: 'STALE_ROUTE' as const };
      } catch {
        return { allowed: false as const, code: 'LAUNCH_EXPIRED' as const };
      }
    };
    if (!(await isActive()) || !admit().allowed) return staleRoute();

    if (isCommerceRequest(request)) {
      const commerce = await import('./experience-commerce-dispatcher');
      // The route, publication, shopper partition, or customer identity may
      // change while the commerce chunk is loading. Revalidate the original
      // admission before the chunk can touch the live cart or present checkout.
      if (!(await isActive()) || !admit().allowed) return staleRoute();
      const acceptPartition = (verified: string) => {
        if (!admit().allowed) return false;
        rebind(verified);
        original.binding.shopperPartition = verified;
        return true;
      };
      return commerce.dispatchExperienceCommerceRequest(request, {
        state: s,
        live,
        merchantSlug,
        present,
        admit,
        rebind: acceptPartition,
        isActive,
        identityMatches: () =>
          JSON.stringify(getLiveCustomerIdentity()) === identity,
      });
    }

    switch (request.method) {
      case 'navigation.go':
        return {
          status: 'ok',
          value: await host.navigate(String(request.args.path)),
        };
      case 'navigation.open':
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Use the trusted storefront link.',
        };
      case 'catalog.collection':
        return {
          status: 'ok',
          value: await readExperienceCatalog(s.data.stateUrl, {
            handle: String(request.args.handle),
          }),
        };
      case 'catalog.product': {
        const p = (
          await readExperienceCatalog(s.data.stateUrl, {
            productSlug: String(request.args.handle),
          })
        ).products[0];
        return p
          ? { status: 'ok', value: p }
          : {
              status: 'error',
              code: 'NOT_FOUND',
              message: 'Product unavailable.',
            };
      }
      case 'catalog.variants': {
        const p = (
          await readExperienceCatalog(s.data.stateUrl, {
            productId: String(request.args.productId),
          })
        ).products[0];
        return p
          ? { status: 'ok', value: p.variants }
          : {
              status: 'error',
              code: 'NOT_FOUND',
              message: 'Product unavailable.',
            };
      }
      default:
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Use the trusted storefront link.',
        };
    }
  };
}
