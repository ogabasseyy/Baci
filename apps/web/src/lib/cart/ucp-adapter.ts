import {
  type CartCommand,
  type CartInputLine,
  validateCartCommand,
} from '@baci/shared/cart';

import {
  migratedCartRefreshOutcome,
  ucpCartCallerMismatch,
} from '@/lib/agentic/ucp-cart-storage';
import { UCP_PROFILE_VERSION } from '@/lib/agentic/ucp-profile-constants';

/**
 * Boundary between platform (UCP) carts and the canonical shared cart.
 *
 * Platform-owned carts keep serialized replacement, but every write is
 * planned through the canonical cart command contract and applied under
 * an optimistic version precondition, so a stale platform replacement
 * loses with `version_conflict` instead of overwriting a newer cart.
 * Once `migratedToCartId` is set, the canonical cart owns the shopper
 * session: platform replacement, cancel and checkout conversion all
 * receive the same refresh outcome, and a delayed platform write can
 * never erase or overwrite the linked web/app cart. Receipts are
 * scoped by verified platform caller (see the caller-scope migration),
 * and cart transfer readiness is advertised independently of native
 * checkout readiness. A platform-principal delegation into the
 * canonical RPC service remains future work requiring its own scoped
 * role and SQL proof; see docs/qa/shared-cart-acceptance.md.
 */
export const UCP_CART_PROFILE_VERSION = UCP_PROFILE_VERSION;

/**
 * Version precondition for a platform-owned cart row. The row has no
 * canonical version column, so its committed `updated_at` is the
 * optimistic-concurrency token: a replacement planned against a stale
 * token must not overwrite a newer committed replacement.
 */
export function ucpCartVersionPrecondition(cart: {
  updated_at?: string | null;
}): string | null {
  return cart.updated_at ?? null;
}

export type PlanUcpCartReplacementResult =
  | {
      ok: true;
      command: Extract<CartCommand, { type: 'replace' }>;
      precondition: string | null;
    }
  | { ok: false; code: 'invalid_item' };

/**
 * Plans a platform full-cart replacement through the canonical cart
 * command contract (same identity, bounds and structural validation as
 * the shared service), so platform writes stop inventing their own
 * cart rules. Pricing stays server-authoritative at calculation time.
 */
export function planUcpCartReplacement(input: {
  lines: CartInputLine[];
  updatedAt?: string | null;
}): PlanUcpCartReplacementResult {
  const command: Extract<CartCommand, { type: 'replace' }> = {
    type: 'replace',
    lines: input.lines,
  };
  if (validateCartCommand(command)) return { code: 'invalid_item', ok: false };
  return {
    command,
    ok: true,
    precondition: input.updatedAt ?? null,
  };
}

export function platformWriteGate(input: {
  migratedToCartId?: string | null;
  cartAgentId?: string | null;
  callerAgentId?: string | null;
}):
  | { allowed: true }
  | { allowed: false; status: 404; body: { error: string } }
  | {
      allowed: false;
      status: 409;
      body: { cart_id: string | null; code: string; error: string };
    } {
  if (
    ucpCartCallerMismatch({ agent_id: input.cartAgentId }, input.callerAgentId)
  ) {
    return {
      allowed: false,
      body: { error: 'Cart not found' },
      status: 404,
    };
  }
  const migrated = migratedCartRefreshOutcome(input);
  if (migrated) {
    return { allowed: false, body: migrated.body, status: migrated.status };
  }
  return { allowed: true };
}
