import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { useRef } from 'react';
import { walletPayPurchaseKeys } from '@/components/wallet-pay/wallet-pay-purchase-keys';
import type { PendingImeiLookup } from '@/lib/imei-pending-storage';
import { createLogger } from '@/lib/logger';
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

const log = createLogger('ImeiRequestIdentity');

/** Shown when the key can't be saved first: nothing is paid on a guess. */
export const IMEI_KEY_UNAVAILABLE =
  "We couldn't safely prepare this check on your phone. Please try again.";

type Identity =
  | { key: string; saved?: SavedRequest }
  | { error: string | null };

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
 * dropped only once the server reports a final result. Like the key store,
 * it fails closed: a key that can't be read or saved is never replaced by
 * an unsaved one (that could pay twice), so the tap shows "try again".
 */
export function useImeiRequestIdentity(createKey: () => string) {
  const active = useRef<ImeiRequestIdentity | null>(null);
  // A removal that doesn't reach the phone is dropped from the key store's
  // memory anyway, and its next save rewrites the phone's copy without it.
  // Left on the phone after a restart, it only replays the finished lookup
  // (its result again, never a second charge), so it is logged, not fatal.
  const forget = (request: SavedRequest) =>
    walletPayPurchaseKeys
      .forget(request.purchase, request.key)
      .catch((error: unknown) => log.error('Saved key not removed', error));
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
      if (request) void forget(request);
    },
    /**
     * True while a store credit request for this check keeps its key (its
     * answer was lost, even before a restart): it must be replayed, never
     * switched to another rail. A key store that can't be read counts as
     * kept: the store credit rail then answers "try again", never another
     * rail on a guess.
     */
    async retains(tier: ImeiServiceTierKey, raw: string, device: Device = '') {
      const identifier = normalize(raw);
      const owner = signedIn();
      if (matches(tier, identifier, device, owner)) return true;
      if (!owner) return false;
      return await purchaseFor(owner, device, tier, identifier)
        .then((purchase) => walletPayPurchaseKeys.has(purchase))
        .catch(() => true);
    },
    /**
     * The key to send, saved first. Otherwise an error to show (the key
     * could not be saved), or a null error when the signed-in account
     * changed while it was read: nothing is sent either way.
     */
    async get(
      tier: ImeiServiceTierKey,
      raw: string,
      device: Device = ''
    ): Promise<Identity> {
      const identifier = normalize(raw);
      const owner = signedIn();
      // Another account never replays this one's key (Muse): it mints anew.
      if (matches(tier, identifier, device, owner) && active.current)
        return { key: active.current.key, saved: active.current.saved };
      let saved: SavedRequest | undefined;
      if (owner) {
        try {
          const purchase = await purchaseFor(owner, device, tier, identifier);
          const key = await walletPayPurchaseKeys.keyFor(purchase, createKey);
          saved = { key, purchase };
        } catch (error) {
          log.error('Saved key unavailable', error);
          return { error: IMEI_KEY_UNAVAILABLE };
        }
        if (signedIn() !== owner) return { error: null };
      }
      // Signed out: the server answers sign-in, so nothing is saved.
      const identity = {
        owner,
        identifier,
        device,
        key: saved?.key ?? createKey(),
        tier,
        saved,
      };
      active.current = identity;
      return { key: identity.key, saved };
    },
  };
}
