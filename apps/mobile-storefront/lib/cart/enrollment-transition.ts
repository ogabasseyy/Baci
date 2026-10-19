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

/**
 * An initial refresh failure before any snapshot must leave the
 * loading state so the status panel can offer manual retry; later
 * failures keep the last good snapshot visible.
 */
export function reportInitialRefreshFailure(
  error: unknown,
  deps: {
    isCurrent: () => boolean;
    hasSnapshot: () => boolean;
    clearLoading: () => void;
    setError: (code: string) => void;
    errorCode: (error: unknown) => string | undefined;
  }
): void {
  if (!deps.isCurrent() || deps.hasSnapshot()) return;
  deps.clearLoading();
  deps.setError(deps.errorCode(error) ?? 'temporarily_unavailable');
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
  // Retry transient storage failures in-process before giving up:
  // a single failed SecureStore delete must not strand the proof
  // until some later lifecycle event happens to retry it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await remove(merchantId);
      state.pendingMerchantId = null;
      return;
    } catch {
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * (attempt + 1))
        );
      }
    }
  }
  // Keep the pending merchant so the next disabled pass (or the
  // sign-out teardown, whichever runs first) retries the deletion
  // instead of stranding an account-owned proof for the next owner.
}

/**
 * Legacy-cart cleanup when enrollment turns off: discarding the
 * canonical reference also rotates its checkout generation and
 * releases the old generation's recovery state, so the next legacy
 * cart cannot inherit the abandoned cart's frozen credit choices or
 * order attempt.
 */
export function retireLegacySharedCart(deps: {
  getLegacy: () => {
    checkoutGeneration: string;
  };
  clearLegacy: (nextGeneration: string) => void;
  mintGeneration: () => string;
  persistGeneration: (generation: string) => void;
  releaseGeneration: (generation: string) => void;
}): void {
  // Callers invoke this only after a committed enabled period; the
  // canonical lifecycle owned the checkout generation for its whole
  // duration, even if the reference itself was already published away.
  const legacy = deps.getLegacy();
  const nextGeneration = deps.mintGeneration();
  deps.clearLegacy(nextGeneration);
  deps.persistGeneration(nextGeneration);
  deps.releaseGeneration(legacy.checkoutGeneration);
}

/** Publishes the controller's actions into the native shared-cart store. */
export function bindControllerActions(
  controller: {
    refresh: unknown;
    prepare: unknown;
    pair: unknown;
    chooseLegacy: unknown;
    linkAccount: unknown;
    reviewCheckout: unknown;
    savedCart: () => Promise<unknown>;
  },
  isCurrent: () => boolean,
  setState: (partial: Record<string, unknown>) => void
): void {
  setState({
    refresh: controller.refresh,
    prepare: controller.prepare,
    pair: controller.pair,
    chooseLegacy: controller.chooseLegacy,
    linkAccount: controller.linkAccount,
    prepareCheckoutReview: controller.reviewCheckout,
    loadSavedCart: async () => {
      const saved = await controller.savedCart();
      if (isCurrent()) setState({ savedCart: saved ?? null });
    },
  });
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
