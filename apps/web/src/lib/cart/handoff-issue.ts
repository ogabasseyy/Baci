import { randomUUID } from 'node:crypto';
import type { CartErrorCode } from '@baci/shared/cart';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCartPreviousSessionSecrets } from './cart-runtime-env';
import {
  buildHandoffContinueUrl,
  createHandoffToken,
  type HandoffDestination,
  type HandoffMerchantRef,
  hashHandoffToken,
  isRecord,
} from './handoff-token';
import type { CartPrincipal } from './principal';
import { CartRepositoryError } from './repository';
import { ERROR_CODES } from './repository-envelope';

export interface IssueHandoffResult {
  ok: boolean;
  code?: CartErrorCode;
  continueUrl?: string;
  handoffId?: string;
  expiresAt?: string;
  replayed?: boolean;
}

export interface IssueHandoffDeps {
  client: SupabaseClient;
  secret?: string;
  environment: string;
  merchant: HandoffMerchantRef;
}

/**
 * Issues a handoff grant for an origin session principal. Sends only
 * the token hash to the database; operation records stay
 * credential-free and replays converge on the original grant.
 */
export async function issueCartHandoff(
  deps: IssueHandoffDeps,
  principal: CartPrincipal,
  input: { destination: HandoffDestination; operationId: string }
): Promise<IssueHandoffResult> {
  if (principal.scope !== 'session' || !principal.cartId) {
    return { code: 'unauthorized', ok: false };
  }
  if (input.destination.type !== 'web' && input.destination.type !== 'native') {
    return { code: 'invalid_item', ok: false };
  }
  if (
    input.destination.type === 'native' &&
    input.destination.app !== 'storefront'
  ) {
    return { code: 'invalid_item', ok: false };
  }
  const operationId = input.operationId?.trim() ?? '';
  if (!operationId || operationId.length > 128) {
    return { code: 'invalid_item', ok: false };
  }

  const tokenInput = {
    cartId: principal.cartId,
    destination: input.destination,
    environment: deps.environment,
    merchantId: principal.merchantId,
    operationId,
    principalId: principal.principalId,
  };
  let token = createHandoffToken(tokenInput, deps.secret);
  const handoffId = randomUUID();
  const args = {
    p_cart_id: principal.cartId,
    p_destination: input.destination,
    p_handoff_id: handoffId,
    p_operation_id: operationId,
    p_token_hash: hashHandoffToken(token),
  };
  let response = await deps.client.rpc('commerce_cart_issue_handoff', args);
  // A committed operation may predate key rotation. Only a definitive
  // operation conflict permits probing the bounded approved key ring;
  // transport failures remain indeterminate and never trigger another issue.
  for (const previous of getCartPreviousSessionSecrets()) {
    if (
      response.error ||
      !isRecord(response.data) ||
      response.data.code !== 'idempotency_conflict'
    )
      break;
    token = createHandoffToken(tokenInput, previous.secret);
    response = await deps.client.rpc('commerce_cart_issue_handoff', {
      ...args,
      p_token_hash: hashHandoffToken(token),
    });
  }
  if (response.error) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_issue_handoff failed'
    );
  }
  const data = response.data as Record<string, unknown> | null;
  if (!isRecord(data) || data.ok !== true) {
    const code = isRecord(data) ? data.code : null;
    return {
      code:
        typeof code === 'string' && ERROR_CODES.has(code)
          ? (code as CartErrorCode)
          : 'temporarily_unavailable',
      ok: false,
    };
  }
  const handoff = data.handoff;
  if (
    !isRecord(handoff) ||
    typeof handoff.id !== 'string' ||
    typeof handoff.expiresAt !== 'string'
  ) {
    throw new CartRepositoryError(
      'temporarily_unavailable',
      'Cart RPC commerce_cart_issue_handoff returned a malformed grant'
    );
  }
  return {
    continueUrl: buildHandoffContinueUrl(deps.merchant, token, handoff.id),
    expiresAt: handoff.expiresAt,
    handoffId: handoff.id,
    ok: true,
    replayed: data.replayed === true,
  };
}
