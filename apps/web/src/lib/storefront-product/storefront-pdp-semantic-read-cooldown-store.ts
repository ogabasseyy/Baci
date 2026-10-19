import {
  STOREFRONT_PDP_SEMANTIC_COOLDOWN_MAX_ENTRIES,
  STOREFRONT_PDP_SEMANTIC_FAILURE_COOLDOWN_MS,
} from './storefront-pdp-semantic-read-cooldown-constants';
import type { StorefrontPdpSemanticReadCooldown } from './storefront-pdp-semantic-read-cooldown-types';

export const createStorefrontPdpSemanticReadCooldown = (options?: {
  cooldownMs?: number;
  maxEntries?: number;
}): StorefrontPdpSemanticReadCooldown => {
  const cooldownMs =
    options?.cooldownMs ?? STOREFRONT_PDP_SEMANTIC_FAILURE_COOLDOWN_MS;
  const maxEntries =
    options?.maxEntries ?? STOREFRONT_PDP_SEMANTIC_COOLDOWN_MAX_ENTRIES;
  const expires = new Map<string, number>();
  return {
    clear: (scope) => {
      expires.delete(scope);
    },
    isCoolingDown: (scope, now = Date.now()) => {
      const at = expires.get(scope);
      if (at === undefined) return false;
      if (at <= now) {
        expires.delete(scope);
        return false;
      }
      return true;
    },
    markFailure: (scope, now = Date.now()) => {
      for (const [key, at] of expires) if (at <= now) expires.delete(key);
      if (expires.size >= maxEntries && !expires.has(scope)) {
        const oldestScope = expires.keys().next().value;
        if (oldestScope !== undefined) expires.delete(oldestScope);
      }
      expires.set(scope, now + cooldownMs);
    },
    reset: () => {
      expires.clear();
    },
  };
};
