import { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';
import { rememberChatwootSessionToken } from './chatwoot-session-token-aliases';

type CartRef = { cartId: string; version: number } | null;

/**
 * Authorizes one inline Chatwoot action against the server and reports whether
 * the cart it was authorized for is still the cart on screen. A renewed
 * browser proof is reported through `onSessionTokenRenewed` before returning.
 */
export async function authorizeChatwootInlineCartAction(input: {
  isQuantityEdit: boolean;
  sessionToken: string;
  storeSlug: string;
  actionGeneration: number;
  getLatestActionGeneration: () => number;
  isMessageTokenKnown: () => boolean;
  tokenAliases: Set<string>;
  initialSessionToken: string | null;
  requestedCartRef: CartRef;
  getCurrentCartRef: () => CartRef;
  onSessionTokenRenewed: (sessionToken: string) => void;
}) {
  let authorized: Awaited<
    ReturnType<typeof authorizeChatwootBridgeSession>
  > | null;
  try {
    authorized = await authorizeChatwootBridgeSession(
      input.sessionToken,
      input.storeSlug
    );
  } catch {
    authorized = null;
  }
  let actionSessionToken = input.sessionToken;
  if (
    authorized?.sessionToken &&
    input.isMessageTokenKnown() &&
    input.actionGeneration === input.getLatestActionGeneration()
  ) {
    rememberChatwootSessionToken(
      input.tokenAliases,
      authorized.sessionToken,
      input.initialSessionToken
    );
    input.onSessionTokenRenewed(authorized.sessionToken);
    actionSessionToken = authorized.sessionToken;
  }
  const currentCartRef = input.getCurrentCartRef();
  const authorizedVersionIsCurrent = input.isQuantityEdit
    ? (authorized?.snapshot.cartVersion ?? -1) >=
      (currentCartRef?.version ?? Number.POSITIVE_INFINITY)
    : authorized?.snapshot.cartVersion === currentCartRef?.version;
  const actionStillCurrent =
    input.actionGeneration === input.getLatestActionGeneration() &&
    input.requestedCartRef !== null &&
    currentCartRef?.cartId === input.requestedCartRef.cartId &&
    currentCartRef.version === input.requestedCartRef.version &&
    authorized?.cartId === currentCartRef.cartId &&
    authorizedVersionIsCurrent;
  return { authorized, actionSessionToken, actionStillCurrent };
}
