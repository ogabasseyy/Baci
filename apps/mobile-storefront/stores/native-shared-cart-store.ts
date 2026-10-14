import type {
  CartItemIdentity,
  CartMergeResolution,
  CartSnapshot,
} from '@baci/shared/cart';
import { create } from 'zustand';
import type { NativeCartStatus } from '@/lib/cart/controller';
import type { CartPairingLink } from '@/lib/cart/pairing-link';
import type { NativeAccountLinkInput } from '@/lib/cart/shared-cart-client';
import type { NativeCheckoutSnapshot } from '@/schemas/cart-checkout-snapshot';

interface SharedCartState {
  enabled: boolean;
  status: NativeCartStatus;
  code?: string;
  snapshot: CartSnapshot | null;
  metadataReady: boolean;
  mergeConflicts: CartItemIdentity[];
  mergeConflictReason?: string;
  refresh: (() => Promise<void>) | null;
  prepare: (() => Promise<void>) | null;
  pair:
    | ((
        link: CartPairingLink,
        choice: 'connect' | 'merge' | 'keep_existing',
        resolutions?: CartMergeResolution[]
      ) => Promise<void>)
    | null;
  chooseLegacy:
    | ((
        choice: 'keep_server' | 'merge',
        resolutions?: CartMergeResolution[]
      ) => Promise<void>)
    | null;
  /** Signed-in shopper id published by the bridge; never a credential. */
  accountUserId: string | null;
  savedCart: CartSnapshot | null;
  loadSavedCart: (() => Promise<void>) | null;
  linkAccount: ((input: NativeAccountLinkInput) => Promise<void>) | null;
  checkoutReview: NativeCheckoutSnapshot | null;
  prepareCheckoutReview:
    | ((operationId: string) => Promise<{
        snapshot: NativeCheckoutSnapshot;
        replayed: boolean;
        sessionReused: boolean;
      }>)
    | null;
}
/** Ephemeral, nonsecret authority status. Proofs and pairing tokens never enter this store. */
export const useNativeSharedCartStore = create<SharedCartState>(() => ({
  enabled: false,
  status: 'loading',
  snapshot: null,
  metadataReady: false,
  mergeConflicts: [],
  refresh: null,
  prepare: null,
  pair: null,
  chooseLegacy: null,
  accountUserId: null,
  savedCart: null,
  loadSavedCart: null,
  linkAccount: null,
  checkoutReview: null,
  prepareCheckoutReview: null,
}));
