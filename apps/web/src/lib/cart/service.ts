import type {
  CartMutationInput,
  CartResult,
  CreateCartInput,
} from '@baci/shared/cart';
import { validateCartCommand } from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCartSnapshot } from './pricing';
import type { CartPrincipal } from './principal';
import {
  CartRepositoryError,
  type RawMutationResult,
  rpcCreateCart,
  rpcGetCart,
  rpcMutateCart,
} from './repository';

export interface CartServiceDeps {
  client: SupabaseClient;
  principal: CartPrincipal;
}

const MAX_OPERATION_ID_LENGTH = 128;
const ISO_CURRENCY = /^[A-Z]{3}$/;

function validOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_OPERATION_ID_LENGTH
  );
}

function shapeResult(
  result: RawMutationResult,
  operationId: string
): CartResult {
  if (!result.ok || !result.state) {
    if (!result.ok && result.state && result.code) {
      const priced = buildCartSnapshot(result.state);
      return { cart: priced.snapshot, code: result.code, ok: false };
    }
    return {
      code: result.code ?? 'temporarily_unavailable',
      ok: false,
    };
  }
  const priced = buildCartSnapshot(result.state);
  return {
    cart: priced.snapshot,
    ...(result.grantId ? { grantId: result.grantId } : null),
    ok: true,
    operationId,
    replayed: result.replayed || result.state.replayed,
    warnings: priced.warnings,
  };
}

function repositoryFailure(error: unknown): CartResult {
  if (error instanceof CartRepositoryError) {
    return { code: error.code, ok: false };
  }
  return { code: 'temporarily_unavailable', ok: false };
}

/** Reads the current authoritative snapshot for a session principal. */
export async function getCart(deps: CartServiceDeps): Promise<CartResult> {
  if (deps.principal.scope !== 'session' || !deps.principal.cartId) {
    return { code: 'unauthorized', ok: false };
  }
  try {
    const result = await rpcGetCart(deps.client, deps.principal.cartId);
    return shapeResult(result, '');
  } catch (error) {
    return repositoryFailure(error);
  }
}

/**
 * Atomically creates a cart, its initial grant and the creation receipt
 * for a bootstrap principal. Real prices come from the catalog inside the
 * transaction; client input carries identity and quantity only.
 */
export async function createCart(
  deps: CartServiceDeps,
  input: CreateCartInput
): Promise<CartResult> {
  if (deps.principal.scope !== 'bootstrap' || deps.principal.cartId) {
    return { code: 'unauthorized', ok: false };
  }
  if (!validOperationId(input.operationId)) {
    return { code: 'invalid_item', ok: false };
  }
  const currency = input.currency ?? 'NGN';
  if (!ISO_CURRENCY.test(currency)) {
    return { code: 'invalid_item', ok: false };
  }
  const structural = validateCartCommand({
    lines: input.lines ?? [],
    type: 'replace',
  });
  if (structural) {
    return { code: 'invalid_item', ok: false };
  }
  try {
    const result = await rpcCreateCart(deps.client, {
      currency,
      lines: input.lines ?? [],
      operationId: input.operationId,
    });
    return shapeResult(result, input.operationId);
  } catch (error) {
    return repositoryFailure(error);
  }
}

/** Applies one versioned, idempotent command for a session principal. */
export async function mutateCart(
  deps: CartServiceDeps,
  input: CartMutationInput
): Promise<CartResult> {
  if (deps.principal.scope !== 'session' || !deps.principal.cartId) {
    return { code: 'unauthorized', ok: false };
  }
  if (
    !validOperationId(input.operationId) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    return { code: 'invalid_item', ok: false };
  }
  if (!deps.principal.allowedOperations.includes(input.command.type)) {
    return { code: 'unauthorized', ok: false };
  }
  if (validateCartCommand(input.command)) {
    return { code: 'invalid_item', ok: false };
  }
  try {
    const result = await rpcMutateCart(deps.client, {
      cartId: deps.principal.cartId,
      command: input.command,
      expectedVersion: input.expectedVersion,
      operationId: input.operationId,
    });
    return shapeResult(result, input.operationId);
  } catch (error) {
    return repositoryFailure(error);
  }
}
