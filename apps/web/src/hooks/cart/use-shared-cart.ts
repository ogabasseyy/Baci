'use client';

import { DEFAULT_ASSURANCE_RATE } from '@/lib/checkout/constants';
import { createCartActions } from './shared-cart-actions';
import {
  noop,
  type UseSharedCartOptions,
  type UseSharedCartResult,
} from './shared-cart-hook-support';
import { createCartProvisioning } from './shared-cart-provisioning';
import { isTerminalCart } from './shared-cart-queue';
import { createCartRecovery } from './shared-cart-recovery';
import { deriveSyncStatus } from './shared-cart-reducer';
import { createCartSnapshotActions } from './shared-cart-snapshots';
import { useCartLinkLifecycle } from './use-cart-link-lifecycle';
import { useCartSendQueue } from './use-cart-send-queue';
import { useCartSubscription } from './use-cart-subscription';
import { useSharedCartRuntime } from './use-shared-cart-runtime';

export type {
  UseSharedCartOptions,
  UseSharedCartResult,
} from './shared-cart-hook-support';
export function useSharedCart(
  options: UseSharedCartOptions
): UseSharedCartResult {
  const runtime = useSharedCartRuntime(options);
  const { state, enabled, hydrated } = runtime;
  const snapshots = createCartSnapshotActions(runtime);
  const connected = useCartSubscription({
    enabled:
      runtime.enabled && runtime.realtimeEnabled && runtime.surfaceActive,
    merchantId: runtime.merchantId,
    merchantSlug: runtime.merchantSlug,
    cartId: state.cartId,
    version: state.confirmed?.version ?? 0,
    generation: runtime.sessionGeneration,
    onRefresh: () => snapshots.refreshNow(true),
  });
  const provisioning = createCartProvisioning({ ...runtime, ...snapshots });
  useCartLinkLifecycle({
    ...runtime,
    ...snapshots,
    ensureCart: provisioning.ensureCart,
    realtimeConnected: runtime.realtimeConnected || connected,
  });
  useCartSendQueue({ ...runtime, ...snapshots, ...provisioning });
  const actions = createCartActions(runtime);
  const recovery = createCartRecovery({
    ...runtime,
    ...snapshots,
    ...provisioning,
  });
  const {
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    repriceLine,
    toggleAssurance,
  } = actions;
  const {
    retryPendingSync,
    refreshSharedCart,
    retryImport,
    discardLegacyImport,
    resolveImportConflicts,
  } = recovery;

  const cartCount = state.display.reduce(
    (sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0),
    0
  );

  const cartTotal = state.display.reduce((sum, item) => {
    // Mirror the server: a negotiated price counts only once accepted;
    // pending/rejected proposals total at catalog.
    const unitPrice =
      item.negotiatedPrice != null &&
      item.negotiationStatus !== 'pending' &&
      item.negotiationStatus !== 'rejected'
        ? item.negotiatedPrice
        : item.price;
    const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
    const itemTotal = unitPrice * quantity;
    // Mirror the server premium: rounded per line to whole cents,
    // not a fractional multiplier over the line total.
    const assurancePremium =
      item.hasAssurance === true
        ? Math.round(
            unitPrice *
              100 *
              quantity *
              (item.assuranceRate ?? DEFAULT_ASSURANCE_RATE)
          ) / 100
        : 0;
    return sum + itemTotal + assurancePremium;
  }, 0);

  if (!enabled) {
    return {
      addToCart: noop,
      cart: [],
      cartCount: 0,
      cartId: null,
      cartTotal: 0,
      clearCart: noop,
      importConflicts: [],
      importStatus: 'none',
      importWarnings: [],
      isHydrated: true,
      isTerminal: false,
      removeFromCart: noop,
      repriceLine: noop,
      refreshSharedCart: async () => {
        // Disabled hook: nothing to refresh.
      },
      retryImport: noop,
      discardLegacyImport: noop,
      resolveImportConflicts: noop,
      retryPendingSync: noop,
      syncError: null,
      syncStatus: 'synced',
      toggleAssurance: noop,
      updateQuantity: noop,
      version: null,
    };
  }

  return {
    addToCart,
    cart: state.display,
    cartCount,
    cartId: state.cartId,
    cartTotal,
    clearCart,
    importConflicts: state.importConflicts,
    importStatus: state.importStatus,
    importWarnings: state.importWarnings,
    isHydrated: hydrated,
    isTerminal: state.confirmed ? isTerminalCart(state.confirmed) : false,
    removeFromCart,
    repriceLine,
    refreshSharedCart,
    retryImport,
    discardLegacyImport,
    resolveImportConflicts,
    retryPendingSync,
    syncError: state.syncError,
    syncStatus: deriveSyncStatus(state),
    toggleAssurance,
    updateQuantity,
    version: state.confirmed?.version ?? null,
  };
}
