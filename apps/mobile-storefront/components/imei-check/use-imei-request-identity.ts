import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { useRef } from 'react';
import { walletPayPurchaseKeys } from '@/components/wallet-pay/wallet-pay-purchase-keys';
import type { PendingImeiLookup } from '@/lib/imei-pending-storage';
import { useAuthStore } from '@/stores/auth-store';
import { imeiPurchaseName } from './imei-purchase-name';
import { normalizeImeiIdentifier as normalize } from './normalize-imei-identifier';

type SavedRequest = NonNullable<PendingImeiLookup['request']>;
type Device = ImeiDeviceCategory | '';

interface ImeiRequestIdentity {
  /** The account that made the request: a key never replays for another. */
  owner: string | null;
  identifier: string;
  /** The device tab: another device is another request, never a replay. */
  device: Device;
  key: string;
  tier: ImeiServiceTierKey;
  /** Where the key is saved on the phone; absent when it could not be. */
  saved?: SavedRequest;
}

const signedIn = () => useAuthStore.getState().user?.id ?? null;
const purchaseFor = (
  owner: string,
  device: Device,
  tier: ImeiServiceTierKey,
  identifier: string
) => imeiPurchaseName('imei-credit', owner, device, tier, identifier);

/**
 * The store credit check's idempotency key. It is saved on the phone (in
 * the wallet-pay key store, per account, store, device, tier and hashed
 * IMEI) before the request is sent, so a retry after the app was killed
 * mid-request replays the same server lookup instead of paying again. It is
 * dropped only once the server reports a final result.
 */
export function useImeiRequestIdentity(createKey: () => string) {
  const active = useRef<ImeiRequestIdentity | null>(null);
  const matches = (
    tier: ImeiServiceTierKey,
    identifier: string,
    device: Device,
    owner: string | null
  ) =>
    active.current?.identifier === identifier &&
    active.current.tier === tier &&
    active.current.device === device &&
    active.current.owner === owner;

  return {
    /**
     * The server reported a final result: forgets the key, in memory and on
     * the phone. A restored pending lookup passes the key it saved.
     */
    clear(saved?: SavedRequest) {
      const request = saved ?? active.current?.saved;
      active.current = null;
      if (request)
        void walletPayPurchaseKeys
          .forget(request.purchase, request.key)
          .catch(() => undefined);
    },
    /**
     * True while a store credit request for this check keeps its key (its
     * answer was lost, even before a restart): it must be replayed, never
     * switched to another rail.
     */
    async retains(tier: ImeiServiceTierKey, raw: string, device: Device = '') {
      const identifier = normalize(raw);
      const owner = signedIn();
      if (matches(tier, identifier, device, owner)) return true;
      if (!owner) return false;
      return await purchaseFor(owner, device, tier, identifier)
        .then((purchase) => walletPayPurchaseKeys.has(purchase))
        .catch(() => false);
    },
    /**
     * The key to send, saved first. Null when the signed-in account changed
     * while it was read: nothing is sent for the old account's check.
     */
    async get(tier: ImeiServiceTierKey, raw: string, device: Device = '') {
      const identifier = normalize(raw);
      const owner = signedIn();
      // Another account never replays this one's key (Muse): it mints anew.
      if (matches(tier, identifier, device, owner) && active.current)
        return { key: active.current.key, saved: active.current.saved };
      let key: string | null = null;
      let saved: SavedRequest | undefined;
      if (owner) {
        try {
          const purchase = await purchaseFor(owner, device, tier, identifier);
          key = await walletPayPurchaseKeys.keyFor(purchase, createKey);
          saved = { key, purchase };
        } catch {
          // The phone's key store can't be used: the key lives in memory
          // only, as it did before keys were saved.
          key = null;
        }
        if (signedIn() !== owner) return null;
      }
      const identity = {
        owner,
        identifier,
        device,
        key: key ?? createKey(),
        tier,
        saved,
      };
      active.current = identity;
      return { key: identity.key, saved };
    },
  };
}
