import { randomUUID } from 'node:crypto';
import type {
  CartErrorCode,
  CartResult,
  CartSnapshot,
} from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type CartAccountLinkInput,
  cartAccountLinkReceiptSchema,
  cartAccountLinkRequestSchema,
} from '@/schemas/cart-account';
import {
  createHandoffToken,
  type HandoffDestination,
  hashHandoffToken,
} from './handoff-token';
import { buildCartSnapshot } from './pricing';
import type { CartPrincipal } from './principal';
import { parseRawMutationResult } from './repository';
import { ERROR_CODES } from './repository-envelope';
import {
  createCartAccountScopedClient,
  createCartScopedClient,
} from './scoped-client';
import { getCart } from './service';
import type { VerifiedCartCustomer } from './verified-customer';

interface AccountClient {
  rpc(
    name: string,
    args?: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
interface LinkDeps {
  accountClient?: AccountClient;
  snapshotClient?: (principal: CartPrincipal) => SupabaseClient;
  environment: string;
  destination: HandoffDestination;
  secret?: string;
}
function failure(value: unknown): { ok: false; code: CartErrorCode } {
  const code =
    value && typeof value === 'object' && 'code' in value ? value.code : null;
  return {
    ok: false,
    code:
      typeof code === 'string' && ERROR_CODES.has(code)
        ? (code as CartErrorCode)
        : 'temporarily_unavailable',
  };
}
/** Authenticated account read: no cart/grant creation and no buyer profile projection. */
export async function getCustomerCart(
  principal: CartPrincipal,
  customer: VerifiedCartCustomer,
  client?: AccountClient
): Promise<
  { ok: true; cart: CartSnapshot | null } | { ok: false; code: CartErrorCode }
> {
  if (principal.merchantId !== customer.merchantId)
    return { ok: false, code: 'unauthorized' };
  try {
    const { data, error } = await (
      client ?? createCartAccountScopedClient(principal, customer)
    ).rpc('commerce_cart_account_status');
    if (
      error ||
      !data ||
      typeof data !== 'object' ||
      !('ok' in data) ||
      data.ok !== true
    )
      return failure(data);
    if (!('saved' in data) || data.saved === null)
      return { ok: true, cart: null };
    const parsed = parseRawMutationResult({
      ok: true,
      state: data.saved,
      replayed: false,
    });
    if (!parsed.state || parsed.state.merchantId !== principal.merchantId)
      return { ok: false, code: 'temporarily_unavailable' };
    return { ok: true, cart: buildCartSnapshot(parsed.state).snapshot };
  } catch {
    return { ok: false, code: 'temporarily_unavailable' };
  }
}
/** Uses one SQL transaction for the account choice, Task 6 merge and saved-cart pointer. */
export type LinkAccountResult =
  | (Extract<CartResult, { ok: true }> & { principalId: string })
  | Extract<CartResult, { ok: false }>;
export async function linkCartToCustomer(
  principal: CartPrincipal,
  customer: VerifiedCartCustomer,
  input: CartAccountLinkInput,
  deps: LinkDeps
): Promise<LinkAccountResult> {
  if (principal.merchantId !== customer.merchantId)
    return { ok: false, code: 'unauthorized' };
  const validated = cartAccountLinkRequestSchema.safeParse(input);
  if (!validated.success) return { ok: false, code: 'invalid_item' };
  try {
    const body = validated.data;
    const token =
      body.choice === 'merge' && body.expectedSavedCartId
        ? createHandoffToken(
            {
              merchantId: principal.merchantId,
              cartId: body.expectedSavedCartId,
              principalId: principal.principalId,
              operationId: `account:${body.operationId}`,
              environment: deps.environment,
              destination: deps.destination,
            },
            deps.secret
          )
        : null;
    const { data, error } = await (
      deps.accountClient ?? createCartAccountScopedClient(principal, customer)
    ).rpc('commerce_cart_link_account', {
      p_input: body,
      p_source_token_hash: token ? hashHandoffToken(token) : null,
      p_handoff_id: token ? randomUUID() : null,
      p_destination: deps.destination,
    });
    if (error) return { ok: false, code: 'temporarily_unavailable' };
    const receipt = cartAccountLinkReceiptSchema.safeParse(data);
    if (!receipt.success) return failure(data);
    const selected: CartPrincipal = {
      ...principal,
      scope: 'session',
      principalId: receipt.data.principalId,
      cartId: receipt.data.cartId,
      grantId: receipt.data.grantId,
      allowedOperations: [
        'add',
        'set_quantity',
        'remove',
        'clear',
        'replace',
        'set_assurance',
        'set_negotiated_price',
      ],
    };
    const snapshot = await getCart({
      principal: selected,
      client: (deps.snapshotClient ?? createCartScopedClient)(selected),
    });
    if (!snapshot.ok) return snapshot;
    if (
      snapshot.cart.merchantId !== principal.merchantId ||
      snapshot.cart.cartId !== receipt.data.cartId
    )
      return { ok: false, code: 'temporarily_unavailable' };
    return {
      ...snapshot,
      operationId: body.operationId,
      grantId: receipt.data.grantId,
      principalId: receipt.data.principalId,
      replayed: receipt.data.replayed === true,
    };
  } catch {
    return { ok: false, code: 'temporarily_unavailable' };
  }
}
