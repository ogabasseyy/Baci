import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { resolveChatwootCartProofExpiry } from '@/lib/cart/chatwoot-proof-expiry';
import { loadLiveGrantOperations } from '@/lib/cart/grant-operations';
import type { createCartScopedClient } from '@/lib/cart/scoped-client';
import type { getCart, mutateCart } from '@/lib/cart/service';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
} from '@/lib/cart/session-proof';
import type { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  hashCartSessionProof,
  renewChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';

type CartContext = Extract<
  Awaited<ReturnType<typeof loadChatwootCartContext>>,
  { ok: true }
>;
type CommittedResult = Extract<
  Awaited<ReturnType<typeof mutateCart>>,
  { ok: true }
>;

interface RenewalInput {
  cartContext: CartContext;
  client: ReturnType<typeof createCartScopedClient>;
  getLatestCart: typeof getCart;
  principal: CartContext['principal'];
  result: CommittedResult;
  sessionToken: string;
}

export interface QuantityRenewal {
  liveCartVersion: number | null;
  maxAge: number;
  proof: string | null;
  proofGrantExpiry: string | null;
  sessionToken: string | null;
}

/** Re-verifies the committed cart and renews the proof and session capability. */
export async function renewAfterQuantityCommit(
  input: RenewalInput
): Promise<QuantityRenewal> {
  const { cartContext, client, principal, result } = input;
  const getCart = input.getLatestCart;
  const parsed = { data: { sessionToken: input.sessionToken } };

  let renewalGrant: Awaited<ReturnType<typeof loadLiveGrantOperations>> = null;
  try {
    renewalGrant = await loadLiveGrantOperations(client, principal);
  } catch {
    console.error('Chatwoot live grant refresh failed after cart mutation');
  }

  let liveCartVersion =
    !result.replayed &&
    Number.isSafeInteger(result.cart.version) &&
    result.cart.version >= cartContext.state.cartVersion
      ? result.cart.version
      : null;
  let proofCartExpiresAt = result.cart.expiresAt;
  let canRenewProof = true;
  if (result.replayed) {
    let latestCart: Awaited<ReturnType<typeof getCart>> | null = null;
    try {
      latestCart = await getCart({ client, principal });
    } catch {
      canRenewProof = false;
    }
    if (canRenewProof) {
      if (
        !latestCart?.ok ||
        latestCart.cart.cartId !== principal.cartId ||
        latestCart.cart.merchantId !== cartContext.state.merchantId ||
        latestCart.cart.version < cartContext.state.cartVersion ||
        (liveCartVersion !== null && latestCart.cart.version < liveCartVersion)
      ) {
        canRenewProof = false;
      } else {
        liveCartVersion = latestCart.cart.version;
        proofCartExpiresAt = latestCart.cart.expiresAt;
      }
    }
    if (!canRenewProof) liveCartVersion = null;
  } else if (
    result.cart.cartId !== principal.cartId ||
    result.cart.merchantId !== cartContext.state.merchantId
  ) {
    canRenewProof = false;
    liveCartVersion = null;
  }
  if (liveCartVersion === null) {
    canRenewProof = false;
  }

  const proofGrantExpiry =
    canRenewProof && renewalGrant
      ? resolveChatwootCartProofExpiry({
          cartExpiresAt: proofCartExpiresAt,
          existingProofExpiresAt: principal.expiresAt,
          liveGrantExpiresAt: renewalGrant.grantExpiresAt,
        })
      : null;
  // This response refreshes the storefront's shared cart cookie. Preserve
  // the verified proof's existing scope, narrowed by the current live grant.
  const renewableOperations = renewalGrant?.allowedOperations.filter(
    (operation) => principal.allowedOperations.includes(operation)
  );
  let proof: string | null = null;
  if (
    proofGrantExpiry !== null &&
    renewalGrant !== null &&
    renewableOperations?.length
  ) {
    try {
      proof = issueCartSessionProof(
        {
          allowedOperations: renewableOperations,
          cartId: principal.cartId,
          grantId: principal.grantId,
          grantExpiresAt: proofGrantExpiry,
          merchantId: cartContext.state.merchantId,
          principalId: principal.principalId,
          scope: 'session',
        },
        { environment: getCartProofEnvironment() }
      );
    } catch {
      console.error('Chatwoot cart proof reissue failed after commit');
    }
  }
  const maxAge = proofGrantExpiry
    ? cartSessionCookieMaxAge(proofGrantExpiry)
    : 0;
  let sessionToken: string | null = null;
  if (
    proof &&
    maxAge > 0 &&
    proofGrantExpiry !== null &&
    liveCartVersion !== null
  ) {
    try {
      sessionToken = await renewChatwootSessionCapability({
        binding: cartContext.binding,
        sessionToken: parsed.data.sessionToken,
        previousState: cartContext.state,
        nextState: {
          ...cartContext.state,
          cartSessionSha256: hashCartSessionProof(proof),
          cartVersion: liveCartVersion,
        },
      });
    } catch {
      console.error('Chatwoot session renewal failed after cart commit');
    }
  }

  return { liveCartVersion, maxAge, proof, proofGrantExpiry, sessionToken };
}
