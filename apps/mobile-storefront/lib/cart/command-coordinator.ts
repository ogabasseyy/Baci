import type {
  CartMutationInput,
  CartSnapshot,
  CreateCartInput,
} from '@baci/shared/cart';
import {
  type PendingCartBody,
  pendingCartBodySchema,
} from '@/schemas/cart-pending-request';
import { type PendingCartRequest, pendingCartRequest } from './pending-request';
import { type NativeCartClient, NativeCartError } from './shared-cart-client';

interface CoordinatorOptions {
  merchantId: string;
  client: Pick<NativeCartClient, 'create' | 'command'> &
    Partial<
      Pick<
        NativeCartClient,
        | 'recoverCreation'
        | 'recoverHandoff'
        | 'redeem'
        | 'linkAccount'
        | 'recoverAccountLink'
      >
    >;
  getActor(): Promise<string>;
  getOwnerSubject?(): string | null;
  isCurrent(): boolean;
  onSnapshot(snapshot: CartSnapshot): void;
  receipts?: {
    read(merchant: string): Promise<PendingCartRequest | null>;
    save(merchant: string, request: PendingCartRequest): Promise<void>;
    clear(merchant: string, operationId: string): Promise<void>;
  };
}
// Definitive rejections prove this exact request did not commit, so its
// key is released; uncertain outcomes keep the same request/key. Every
// shared server rejection code except the two transient ones
// (temporarily_unavailable, rate_limited) is non-retryable for the
// identical request — replaying it would be rejected again and would
// strand every later write behind pending_operation.
const definitiveServerCodes: ReadonlySet<string> = new Set<string>([
  'unauthorized',
  'merchant_unavailable',
  'not_found',
  'expired',
  'version_conflict',
  'idempotency_conflict',
  'invalid_item',
  'cart_locked',
  'refresh_required',
  'merge_conflict',
  'too_many_lines',
  'handoff_consumed',
  // Route-boundary proof failures are equally definitive for the
  // identical request: the proof is gone or revoked, so replaying the
  // saved receipt can only fail the same way and would strand every
  // later write behind pending_operation.
  'missing_proof',
  'expired_proof',
  'invalid_proof',
  'merchant_mismatch',
]);

function isDefinitiveRejection(error: unknown): boolean {
  return (
    error instanceof NativeCartError &&
    !error.indeterminate &&
    (definitiveServerCodes.has(error.code) || error.code === 'invalid_request')
  );
}

/** Serializes sent operations and keeps the exact request until an acknowledged reply. */
export function createCartCommandCoordinator(options: CoordinatorOptions) {
  const receipts = options.receipts ?? pendingCartRequest;
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const next = tail.then(run, run);
    tail = next;
    return next;
  }
  async function assertActor(actor?: string): Promise<string> {
    const current = await options.getActor();
    if (!options.isCurrent() || !current || (actor && current !== actor))
      throw new NativeCartError('session_changed');
    return current;
  }
  async function transmit(
    request: PendingCartRequest
  ): Promise<CartSnapshot | null> {
    const parsed = pendingCartBodySchema.safeParse(request.body);
    if (
      !parsed.success ||
      (parsed.data.kind === 'handoff'
        ? parsed.data.input.attemptId
        : parsed.data.input.operationId) !== request.operationId
    )
      throw new NativeCartError('invalid_pending_operation');
    const body = parsed.data;
    if (body.kind === 'account') return transmitAccount(request, body);
    await assertActor(request.actor);
    let result: Awaited<ReturnType<NativeCartClient['command']>> | undefined;
    try {
      result =
        body.kind === 'create'
          ? ((await options.client.recoverCreation?.(request.operationId)) ??
            (await options.client.create(body.input)))
          : body.kind === 'handoff'
            ? ((await options.client.recoverHandoff?.(request.operationId)) ??
              (await options.client.redeem?.(body.input)))
            : await options.client.command(body.input, body.cartId);
    } catch (error) {
      if (isDefinitiveRejection(error)) {
        await assertActor(request.actor);
        await receipts.clear(options.merchantId, request.operationId);
      }
      throw error;
    }
    await assertActor(request.actor);
    if (body.kind === 'handoff' && result && !result.cart) {
      // keep_existing with no destination cart: the redemption
      // committed and returned only a bootstrap proof, so there is no
      // snapshot to adopt and nothing left to retry.
      await receipts.clear(options.merchantId, request.operationId);
      await assertActor(request.actor);
      return null;
    }
    if (
      !result?.cart ||
      result.cart.merchantId.toLowerCase() !== options.merchantId.toLowerCase()
    )
      throw new NativeCartError('invalid_cart_reply', true);
    await receipts.clear(options.merchantId, request.operationId);
    await assertActor(request.actor);
    options.onSnapshot(result.cart);
    return result.cart;
  }
  async function transmitAccount(
    request: PendingCartRequest,
    body: Extract<PendingCartBody, { kind: 'account' }>
  ): Promise<CartSnapshot> {
    const assertOwner = () => {
      if (
        !options.isCurrent() ||
        options.getOwnerSubject?.() !== body.ownerSubject
      )
        throw new NativeCartError('session_changed');
    };
    assertOwner();
    const recoverClient = options.client.recoverAccountLink;
    if (!recoverClient || !options.client.linkAccount)
      throw new NativeCartError('temporarily_unavailable');
    // Recovery reads can also be definitively rejected (e.g. the grant
    // was revoked while the app was dead); the same receipt cleanup as
    // the link call applies, or every refresh repeats the dead read.
    const recover = async () => {
      try {
        return await recoverClient(
          request.operationId,
          body.ownerSubject,
          request.actor
        );
      } catch (error) {
        assertOwner();
        if (isDefinitiveRejection(error)) {
          await assertActor(request.actor);
          await receipts.clear(options.merchantId, request.operationId);
        }
        throw error;
      }
    };
    let result = await recover();
    assertOwner();
    if (!result) {
      await assertActor(request.actor);
      try {
        await options.client.linkAccount(body.input);
      } catch (error) {
        assertOwner();
        if (isDefinitiveRejection(error)) {
          await assertActor(request.actor);
          await receipts.clear(options.merchantId, request.operationId);
        }
        throw error;
      }
      assertOwner();
      result = await recover();
    }
    assertOwner();
    if (
      !result?.cart ||
      result.cart.merchantId.toLowerCase() !== options.merchantId.toLowerCase()
    )
      throw new NativeCartError('invalid_cart_reply', true);
    await receipts.clear(options.merchantId, request.operationId);
    assertOwner();
    options.onSnapshot(result.cart);
    return result.cart;
  }
  async function execute(body: PendingCartBody): Promise<CartSnapshot | null> {
    const actor = await assertActor();
    const parsed = pendingCartBodySchema.safeParse(body);
    if (!parsed.success) throw new NativeCartError('invalid_request');
    const pending = await receipts.read(options.merchantId);
    if (pending) {
      const existing = pendingCartBodySchema.safeParse(pending.body);
      if (
        body.kind === 'account' &&
        existing.success &&
        JSON.stringify(existing.data) === JSON.stringify(parsed.data)
      )
        return transmit(pending);
      throw new NativeCartError('pending_operation');
    }
    const request = {
      actor,
      operationId:
        body.kind === 'handoff' ? body.input.attemptId : body.input.operationId,
      body: parsed.data,
    };
    await receipts.save(options.merchantId, request);
    return transmit(request);
  }
  // Only handoff redemption may commit without a snapshot (see
  // transmit); every other kind still owes the caller a cart.
  async function executeCart(body: PendingCartBody): Promise<CartSnapshot> {
    const snapshot = await execute(body);
    if (!snapshot) throw new NativeCartError('invalid_cart_reply', true);
    return snapshot;
  }
  return {
    create: (input: CreateCartInput) =>
      serial(() => executeCart({ kind: 'create', input })),
    command: (cartId: string, input: CartMutationInput) =>
      serial(() => executeCart({ kind: 'command', cartId, input })),
    redeem: (input: Extract<PendingCartBody, { kind: 'handoff' }>['input']) =>
      serial(() => execute({ kind: 'handoff', input })),
    linkAccount: (
      input: Extract<PendingCartBody, { kind: 'account' }>['input']
    ) =>
      serial(() => {
        const ownerSubject = options.getOwnerSubject?.();
        if (!ownerSubject) throw new NativeCartError('unauthorized');
        return executeCart({ kind: 'account', ownerSubject, input });
      }),
    recover: () =>
      serial(async () => {
        await assertActor();
        const request = await receipts.read(options.merchantId);
        return request ? transmit(request) : null;
      }),
  };
}
