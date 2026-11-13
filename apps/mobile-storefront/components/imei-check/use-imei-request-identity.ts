import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { useRef } from 'react';

interface ImeiRequestIdentity {
  identifier: string;
  key: string;
  tier: ImeiServiceTierKey;
}

// One device, one identity, however it was typed (spaces, dashes, case):
// the same rule the wallet pay purchase key uses.
const normalize = (identifier: string) =>
  identifier.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

export function useImeiRequestIdentity(createKey: () => string) {
  const active = useRef<ImeiRequestIdentity | null>(null);

  return {
    clear() {
      active.current = null;
    },
    /**
     * True while a store credit request for this check keeps its key (its
     * answer was lost): it must be replayed, never switched to another rail.
     */
    retains(tier: ImeiServiceTierKey, identifier: string) {
      return (
        active.current?.identifier === normalize(identifier) &&
        active.current.tier === tier
      );
    },
    get(tier: ImeiServiceTierKey, raw: string) {
      const identifier = normalize(raw);
      if (
        active.current?.identifier === identifier &&
        active.current.tier === tier
      ) {
        return active.current.key;
      }
      const key = createKey();
      active.current = { identifier, key, tier };
      return key;
    },
  };
}
