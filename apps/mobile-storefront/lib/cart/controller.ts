import type {
  CartItemIdentity,
  CartMergeResolution,
  CartSnapshot,
} from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
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

import {
  type CartProductShell,
  hydrateNativeCart,
  nativeCartInput,
} from './display';
import { pairNativeCart } from './native-cart-pairing';
import type { CartPairingLink } from './pairing-link';
import { pendingCartRequest } from './pending-request';
import {
  type NativeAccountLinkInput,
  type NativeCartClient,
  NativeCartError,
} from './shared-cart-client';

const TERMINAL_STATES = new Set(['completed', 'expired', 'canceled']);
export function createNativeCartController(
  options: NativeCartControllerOptions
) {
  let snapshot: CartSnapshot | null = null;
  let terminal = false;
  let incoming: CartSnapshot | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  const receipts = options.receipts ?? pendingCartRequest;
  const assurance = new Map<string, boolean>();
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
    display.items = display.items.map((item) =>
      assurance.has(item.id)
        ? { ...item, hasAssurance: assurance.get(item.id) }
        : item
    );
    snapshot = next;
    options.publish(next, display);
    options.status('ready');
  }
  async function refresh(): Promise<void> {
    if (!snapshot) options.status('loading');
    const context = await options.client.context();
    assertCurrent();
    const pending = await receipts.read(options.merchantId);
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
  const operations = createNativeCartWrite({
    accept,
    assurance,
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
    write: (action: SharedCartWrite) => serial(() => operations.write(action)),
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
    savedCart: () =>
      serial(async () => {
        if (!options.client.savedAccountCart)
          throw new NativeCartError('temporarily_unavailable');
        const reply = await options.client.savedAccountCart();
        assertCurrent();
        return reply.cart ?? null;
      }),
    linkAccount: (input: NativeAccountLinkInput) =>
      serial(async () => {
        await ensureCart();
        options.status('pending');
        await accept(await coordinator.linkAccount(input));
      }),
    reviewCheckout: (operationId: string) =>
      serial(async () => {
        const current = await ensureCart();
        if (!options.client.prepareCheckout)
          throw new NativeCartError('temporarily_unavailable');
        options.status('pending');
        try {
          return await options.client.prepareCheckout({
            cartId: current.cartId,
            expectedVersion: current.version,
            operationId,
          });
        } finally {
          if (options.isCurrent()) options.status('ready');
        }
      }),
    chooseLegacy: (
      choice: 'keep_server' | 'merge',
      resolutions: CartMergeResolution[] = []
    ) => serial(() => operations.chooseLegacy(choice, resolutions)),
  };
}
