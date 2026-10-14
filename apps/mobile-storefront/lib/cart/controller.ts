import type {
  CartItemIdentity,
  CartMergeResolution,
  CartSnapshot,
} from '@baci/shared/cart';
import type { CartItem } from '@/stores/cart-store.types';
import type { SharedCartWrite } from '@/stores/shared-cart-writer';
import { createCartCommandCoordinator } from './command-coordinator';
import {
  type CartProductShell,
  hydrateNativeCart,
  nativeCartInput,
} from './display';
import { planNativeLegacyMerge } from './legacy-merge';
import { pairNativeCart } from './native-cart-pairing';
import type { CartPairingLink } from './pairing-link';
import { pendingCartRequest } from './pending-request';
import {
  type NativeAccountLinkInput,
  type NativeCartClient,
  NativeCartError,
} from './shared-cart-client';
import { nativeWriteCommand } from './write-command';

export interface NativeSharedCartRef {
  merchantId: string;
  cartId: string;
}
export type NativeCartStatus =
  | 'loading'
  | 'pending'
  | 'ready'
  | 'error'
  | 'choice_required';
interface Options {
  merchantId: string;
  getOwnerSubject?(): string | null;
  client: Pick<
    NativeCartClient,
    'context' | 'bootstrap' | 'read' | 'create' | 'command' | 'recoverCreation'
  > &
    Partial<
      Pick<
        NativeCartClient,
        | 'redeem'
        | 'recoverHandoff'
        | 'previewHandoff'
        | 'restartSession'
        | 'recoverAccountLink'
        | 'linkAccount'
        | 'savedAccountCart'
        | 'prepareCheckout'
      >
    >;
  receipts?: typeof pendingCartRequest;
  newOperationId(): string;
  getLegacy(): { items: CartItem[]; sharedCartRef?: NativeSharedCartRef };
  loadProduct(
    merchantId: string,
    productId: string
  ): Promise<CartProductShell | null>;
  publish(
    snapshot: CartSnapshot,
    display: { items: CartItem[]; metadataReady: boolean }
  ): void;
  status(status: NativeCartStatus, code?: string): void;
  isCurrent(): boolean;
  onHandoffCommitted?(handoffId: string): void;
  onMergeConflicts?(items: CartItemIdentity[], reason?: string): void;
}
const TERMINAL_STATES = new Set(['completed', 'expired', 'canceled']);
export function createNativeCartController(options: Options) {
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
  return {
    refresh: () => serial(refresh),
    prepare: () =>
      serial(async () => {
        await ensureCart();
      }),
    write: (action: SharedCartWrite) =>
      serial(async () => {
        if (
          action.type === 'legacy_restore' ||
          action.type === 'legacy_generation'
        )
          return;
        if (action.type === 'legacy_reprice') {
          await refresh();
          return;
        }
        const current = await ensureCart();
        options.status('pending');
        if (action.type === 'assurance') {
          const line = options
            .getLegacy()
            .items.find((item) => item.id === action.id);
          if (line) assurance.set(action.id, !line.hasAssurance);
          await accept(current);
          return;
        }
        const command = nativeWriteCommand(action, current);
        if (!command) {
          options.status('ready');
          return;
        }
        await accept(
          await coordinator.command(current.cartId, {
            operationId: options.newOperationId(),
            expectedVersion: current.version,
            command,
          })
        );
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
    ) =>
      serial(async () => {
        if (!incoming) throw new NativeCartError('refresh_required');
        if (choice === 'keep_server') {
          const selected = incoming;
          incoming = null;
          await accept(selected);
          options.onMergeConflicts?.([], undefined);
          return;
        }
        const plan = planNativeLegacyMerge(
          incoming,
          options.getLegacy().items,
          resolutions
        );
        if (!plan.ok) {
          if (plan.code === 'merge_conflict')
            options.onMergeConflicts?.(
              plan.conflicts.map((conflict) => conflict.item),
              plan.reason
            );
          throw new NativeCartError(plan.code);
        }
        const lines = plan.lines;
        const result = await coordinator.command(incoming.cartId, {
          operationId: options.newOperationId(),
          expectedVersion: incoming.version,
          command: { type: 'replace', lines },
        });
        incoming = null;
        await accept(result);
        options.onMergeConflicts?.([], undefined);
      }),
  };
}
