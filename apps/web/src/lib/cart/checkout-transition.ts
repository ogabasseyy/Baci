import type { CartErrorCode } from '@baci/shared/cart';
import {
  isInteger,
  type PrepareCartCheckoutDeps,
  type PrepareCartCheckoutInput,
  type PrepareCartCheckoutResult,
  parseSnapshot,
  validOperationId,
} from './checkout-snapshot';
import { CartRepositoryError } from './repository';
import { ERROR_CODES, isRecord } from './repository-envelope';

/**
 * Reviews the current authoritative cart for checkout: validated lines,
 * estimates and one active session reference. Replays converge on the
 * stored receipt; version drift answers refresh_required with the live
 * version so the caller reconciles instead of submitting stale lines.
 */
export async function prepareCartCheckout(
  deps: PrepareCartCheckoutDeps,
  input: PrepareCartCheckoutInput
): Promise<PrepareCartCheckoutResult> {
  if (
    deps.principal.scope !== 'session' ||
    !deps.principal.cartId ||
    deps.principal.cartId !== input.cartId
  ) {
    return { code: 'unauthorized', currentVersion: null, ok: false };
  }
  if (
    !validOperationId(input.operationId) ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    return { code: 'invalid_item', currentVersion: null, ok: false };
  }
  try {
    const response = await deps.client.rpc('commerce_cart_prepare_checkout', {
      p_cart_id: input.cartId,
      p_expected_version: input.expectedVersion,
      p_operation_id: input.operationId,
    });
    if (response.error) {
      throw new CartRepositoryError(
        'temporarily_unavailable',
        'Cart RPC commerce_cart_prepare_checkout failed'
      );
    }
    const data = response.data;
    if (!isRecord(data) || typeof data.ok !== 'boolean') {
      throw new CartRepositoryError(
        'temporarily_unavailable',
        'Cart RPC commerce_cart_prepare_checkout returned a malformed envelope'
      );
    }
    if (!data.ok) {
      const code =
        typeof data.code === 'string' && ERROR_CODES.has(data.code)
          ? (data.code as CartErrorCode)
          : 'temporarily_unavailable';
      return {
        code,
        currentVersion: isInteger(data.currentVersion)
          ? data.currentVersion
          : null,
        ok: false,
      };
    }
    const snapshot = parseSnapshot(data.snapshot);
    if (!snapshot) {
      throw new CartRepositoryError(
        'temporarily_unavailable',
        'Cart RPC commerce_cart_prepare_checkout returned a malformed snapshot'
      );
    }
    return {
      ok: true,
      replayed: data.replayed === true,
      sessionReused: data.sessionReused === true,
      // Defensive fallback for a database that predates the
      // sessionExpiresAt result field (mixed deploy window).
      sessionExpiresAt:
        typeof data.sessionExpiresAt === 'string'
          ? data.sessionExpiresAt
          : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      snapshot,
    };
  } catch (error) {
    if (error instanceof CartRepositoryError) {
      return { code: error.code, currentVersion: null, ok: false };
    }
    return { code: 'temporarily_unavailable', currentVersion: null, ok: false };
  }
}

export * from './checkout-snapshot';
