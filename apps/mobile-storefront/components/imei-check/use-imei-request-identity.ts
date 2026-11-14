import type { ImeiServiceTierKey } from '@baci/shared/imei';
import { useRef } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { normalizeImeiIdentifier as normalize } from './normalize-imei-identifier';

interface ImeiRequestIdentity {
  /** The account that made the request: a key never replays for another. */
  owner: string | null;
  identifier: string;
  key: string;
  tier: ImeiServiceTierKey;
}

const signedIn = () => useAuthStore.getState().user?.id ?? null;

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
        active.current.tier === tier &&
        active.current.owner === signedIn()
      );
    },
    get(tier: ImeiServiceTierKey, raw: string) {
      const identifier = normalize(raw);
      const owner = signedIn();
      // Another account never replays this one's key (Muse): it mints anew.
      if (
        active.current?.identifier === identifier &&
        active.current.tier === tier &&
        active.current.owner === owner
      ) {
        return active.current.key;
      }
      const key = createKey();
      active.current = { owner, identifier, key, tier };
      return key;
    },
  };
}
