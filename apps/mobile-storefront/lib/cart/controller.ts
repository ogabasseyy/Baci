import type { CartMergeResolution, CartSnapshot } from '@baci/shared/cart';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import { createCartCommandCoordinator } from './command-coordinator';
import type {
  NativeCartControllerOptions,
  NativeCartStatus,
  NativeSharedCartRef,
} from './controller-options';
import { createNativeCartWrite } from './controller-write';

export type {
  NativeCartControllerOptions,
  NativeCartStatus,
  NativeSharedCartRef,
};

import { createNativeCartAccountOps } from './controller-account';
import { hydrateNativeCart, nativeCartInput } from './display';
import { pairNativeCart } from './native-cart-pairing';
import type { CartPairingLink } from './pairing-link';
import { pendingCartRequest } from './pending-request';
import { NativeCartError } from './shared-cart-client';

const TERMINAL_STATES = new Set(['completed', 'expired', 'canceled']);
export function createNativeCartController(
  options: NativeCartControllerOptions
) {
  let snapshot: CartSnapshot | null = null;
  let terminal = false;
  let incoming: CartSnapshot | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const receipts = options.receipts ?? pendingCartRequest;
  function assertCurrent(): void {
    if (!options.isCurrent()) throw new NativeCartError('session_changed');
  }
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = tail
      .catch(() => undefined)
      .then(async () => {
        assertCurrent();
        try {
          return await run();
        } catch (error) {
          if (options.isCurrent())
            options.status(
              error instanceof NativeCartError &&
                error.code === 'legacy_choice_required'
                ? 'choice_required'
                : 'error',
              error instanceof NativeCartError
                ? error.code
                : 'temporarily_unavailable'
            );
          throw error;
        }
      });
    tail = next;
    return next;
  }
  const coordinator = createCartCommandCoordinator({
    ...options,
    receipts,
    getActor: async () => (await options.client.context())?.actor ?? '',
    onSnapshot: () => {
      /* Publish only after tenant-scoped display hydration below. */
    },
  });
  async function accept(next: CartSnapshot): Promise<void> {
    assertCurrent();
    if (next.merchantId.toLowerCase() !== options.merchantId.toLowerCase())
      throw new NativeCartError('merchant_mismatch');
    if (TERMINAL_STATES.has(next.state)) {
      // A finished generation is never offered for checkout or edits; the
      // display clears and the next explicit write starts a fresh cart.
      snapshot = null;
      terminal = true;
      options.publish(next, { items: [], metadataReady: true });
      options.status('ready');
      return;
    }
    terminal = false;
    if (snapshot?.cartId === next.cartId && snapshot.version > next.version)
      return;
    const display = await hydrateNativeCart(
      next,
      options.getLegacy().items,
      options.loadProduct
    );
    assertCurrent();
    snapshot = next;
    options.publish(next, display);
    options.status('ready');
  }
  async function refresh(): Promise<void> {
    if (!snapshot) options.status('loading');
    const context = await options.client.context();
    assertCurrent();
    let pending = await receipts.read(options.merchantId);
    if (!context && options.getLegacy().sharedCartRef && options.repairLegacy) {
      // Retire the local generation after losing its device capability.
      if (pending)
        await receipts.clear(options.merchantId, pending.operationId);
      options.repairLegacy([]);
      pending = null;
      snapshot = null;
      terminal = false;
    }
    assertCurrent();
    if (pending) {
      const recovered = await coordinator.recover();
      if (recovered) {
        await accept(recovered);
        // Idempotency receipts can describe an older version than another device now sees.
        const current = await options.client.context();
        assertCurrent();
        if (!current?.cartId) throw new NativeCartError('refresh_required');
        const latest = await options.client.read(current.cartId);
        assertCurrent();
        if (!latest.cart) throw new NativeCartError('temporarily_unavailable');
        await accept(latest.cart);
        const body = pending.body;
        if (
          body &&
          typeof body === 'object' &&
          'kind' in body &&
          body.kind === 'handoff' &&
          'input' in body &&
          body.input &&
          typeof body.input === 'object' &&
          'handoffId' in body.input &&
          typeof body.input.handoffId === 'string'
        )
          options.onHandoffCommitted?.(body.input.handoffId);
      }
    } else if (context?.cartId) {
      const result = await options.client.read(context.cartId);
      assertCurrent();
      if (!result.cart) throw new NativeCartError('temporarily_unavailable');
      const legacy = options.getLegacy();
      if (
        !TERMINAL_STATES.has(result.cart.state) &&
        !snapshot &&
        legacy.items.length &&
        (legacy.sharedCartRef?.merchantId !== options.merchantId ||
          legacy.sharedCartRef.cartId !== context.cartId)
      ) {
        incoming = result.cart;
        throw new NativeCartError('legacy_choice_required');
      }
      await accept(result.cart);
    } else options.status('ready');
  }
  async function ensureCart(): Promise<CartSnapshot> {
    if (incoming) throw new NativeCartError('legacy_choice_required');
    if (snapshot) return snapshot;
    if (terminal) {
      // Explicit new cart after a completed/expired generation: retire the
      // finished session proof locally and bootstrap a fresh principal.
      if (!options.client.restartSession)
        throw new NativeCartError('refresh_required');
      await options.client.restartSession();
      assertCurrent();
      terminal = false;
    }
    await refresh();
    if (snapshot) return snapshot;
    // Only explicit writes reach here. Never create from a read error or over old intent.
    if (await receipts.read(options.merchantId))
      throw new NativeCartError('pending_operation');
    let context = await options.client.context();
    assertCurrent();
    if (!context) {
      await options.client.bootstrap();
      context = await options.client.context();
      assertCurrent();
    }
    if (!context || context.cartId)
      throw new NativeCartError('refresh_required');
    const legacy = options.getLegacy();
    if (legacy.sharedCartRef) throw new NativeCartError('reconnect_required');
    const created = await coordinator.create({
      operationId: options.newOperationId(),
      lines: legacy.items.map(nativeCartInput),
    });
    await accept(created);
    return created;
  }
  const accountOps = createNativeCartAccountOps({
    accept,
    assertCurrent,
    coordinator,
    ensureCart,
    options,
    serial,
  });
  const operations = createNativeCartWrite({
    accept,
    coordinator,
    ensureCart,
    getIncoming: () => incoming,
    setIncoming: (next) => {
      incoming = next;
    },
    getLegacy: options.getLegacy,
    newOperationId: options.newOperationId,
    onMergeConflicts: options.onMergeConflicts,
    refresh,
    status: options.status,
  });
  return {
    refresh: () => serial(refresh),
    prepare: () =>
      serial(async () => {
        await ensureCart();
      }),
    write: (action: SharedCartWrite) =>
      serial(async () => {
        const legacy = options.getLegacy();
        if (
          !terminal &&
          !snapshot &&
          !incoming &&
          legacy.items.length > 0 &&
          !legacy.sharedCartRef &&
          options.repairLegacy &&
          (action.type === 'clear' ||
            action.type === 'remove' ||
            action.type === 'quantity') &&
          !(await options.client.context())?.cartId &&
          !(await receipts.read(options.merchantId))
        ) {
          const items =
            action.type === 'clear'
              ? []
              : legacy.items.flatMap((item) => {
                  if (item.id !== action.id) return [item];
                  return action.type === 'remove' || action.quantity <= 0
                    ? []
                    : [{ ...item, quantity: action.quantity }];
                });
          options.repairLegacy(items);
          options.status('ready');
          return;
        }
        await operations.write(action);
      }),
    pair: (
      link: CartPairingLink,
      choice: 'connect' | 'merge' | 'keep_existing',
      resolutions: CartMergeResolution[] = []
    ) =>
      serial(() =>
        pairNativeCart(
          {
            ...options,
            readPending: () => receipts.read(options.merchantId),
            getSnapshot: () => snapshot,
            getItems: () => options.getLegacy().items,
            ensureCart,
            refresh,
            accept,
            assertCurrent,
            pending: () => options.status('pending'),
            redeem: coordinator.redeem,
          },
          link,
          choice,
          resolutions
        )
      ),
    ...accountOps,
    chooseLegacy: (
      choice: 'keep_server' | 'merge',
      resolutions: CartMergeResolution[] = []
    ) => serial(() => operations.chooseLegacy(choice, resolutions)),
  };
}
