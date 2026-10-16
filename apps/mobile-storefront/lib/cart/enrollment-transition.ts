/**
 * Tracks native shared-cart enrollment transitions so the secure
 * session record is retired exactly once per committed disable, only
 * after an enabled period was actually installed, and retried after
 * transient storage failures instead of being stranded.
 */
export interface EnrollmentTransition {
  wasEnabled: boolean;
  pendingMerchantId: string | null;
}

export function createEnrollmentTransition(): EnrollmentTransition {
  return { wasEnabled: false, pendingMerchantId: null };
}

export function markEnrollmentEnabled(state: EnrollmentTransition): void {
  state.wasEnabled = true;
}

export async function retireEnrollmentSession(
  state: EnrollmentTransition,
  merchantId: string,
  remove: (merchantId: string) => Promise<void>
): Promise<void> {
  if (state.pendingMerchantId !== merchantId) {
    if (!state.wasEnabled) return;
    state.wasEnabled = false;
    state.pendingMerchantId = merchantId;
  }
  try {
    await remove(merchantId);
    state.pendingMerchantId = null;
  } catch {
    // Keep the pending merchant so the next disabled pass (or the
    // sign-out teardown, whichever runs first) retries the deletion
    // instead of stranding an account-owned proof for the next owner.
  }
}

/** Store reset applied when the shared-cart writer is released. */
export const DISABLED_SHARED_CART_STATE: {
  enabled: boolean;
  accountsEnabled: boolean;
  status: 'loading';
  snapshot: null;
  metadataReady: boolean;
  mergeConflicts: never[];
  mergeConflictReason: undefined;
  refresh: null;
  prepare: null;
  pair: null;
  chooseLegacy: null;
  savedCart: null;
  loadSavedCart: null;
  linkAccount: null;
  checkoutReview: null;
  prepareCheckoutReview: null;
} = {
  enabled: false,
  accountsEnabled: false,
  status: 'loading',
  snapshot: null,
  metadataReady: false,
  mergeConflicts: [],
  mergeConflictReason: undefined,
  refresh: null,
  prepare: null,
  pair: null,
  chooseLegacy: null,
  savedCart: null,
  loadSavedCart: null,
  linkAccount: null,
  checkoutReview: null,
  prepareCheckoutReview: null,
};
