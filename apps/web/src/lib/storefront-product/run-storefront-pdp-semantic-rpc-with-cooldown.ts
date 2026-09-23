import { isStorefrontPdpSemanticTimeout } from './is-storefront-pdp-semantic-timeout';
import { storefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-singleton';
import {
  type AbortableQuery,
  runStorefrontPdpSemanticRpc,
  type StorefrontPdpSemanticRpcOptions,
  type StorefrontPdpSemanticRpcResult,
} from './storefront-pdp-semantic-rpc';

export async function runStorefrontPdpSemanticRpcWithCooldown<T>(
  query: AbortableQuery<T>,
  options: StorefrontPdpSemanticRpcOptions,
  scope: string
): Promise<StorefrontPdpSemanticRpcResult<T>>;
export async function runStorefrontPdpSemanticRpcWithCooldown<T>(
  createQuery: () => AbortableQuery<T>,
  options: StorefrontPdpSemanticRpcOptions,
  scope: string,
  createFallback: () => T
): Promise<StorefrontPdpSemanticRpcResult<T>>;
export async function runStorefrontPdpSemanticRpcWithCooldown<T>(
  queryOrFactory: AbortableQuery<T> | (() => AbortableQuery<T>),
  options: StorefrontPdpSemanticRpcOptions,
  scope: string,
  createFallback?: () => T
): Promise<StorefrontPdpSemanticRpcResult<T>> {
  if (typeof queryOrFactory === 'function') {
    if (storefrontPdpSemanticReadCooldown.isCoolingDown(scope)) {
      if (!createFallback) {
        throw new TypeError('A cooldown fallback is required for lazy queries');
      }
      return { response: createFallback(), trace: () => undefined };
    }
    return runStorefrontPdpSemanticRpcWithCooldown(
      queryOrFactory(),
      options,
      scope
    );
  }
  try {
    return await runStorefrontPdpSemanticRpc(queryOrFactory, options);
  } catch (error) {
    if (isStorefrontPdpSemanticTimeout(error)) {
      storefrontPdpSemanticReadCooldown.markFailure(scope);
    }
    throw error;
  }
}
