import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { useRef } from 'react';

interface ImeiRequestIdentity {
  identifier: string;
  key: string;
  tier: ImeiServiceTierKey;
  scope: string;
}

export function useImeiRequestIdentity(createKey: () => string) {
  const active = useRef<ImeiRequestIdentity | null>(null);

  return {
    clear() {
      active.current = null;
    },
    get(tier: ImeiServiceTierKey, identifier: string, scope = '') {
      if (
        active.current?.scope === scope &&
        active.current?.identifier === identifier &&
        active.current.tier === tier
      ) {
        return active.current.key;
      }
      const key = createKey();
      active.current = { identifier, key, tier, scope };
      return key;
    },
  };
}
