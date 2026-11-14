import { authorizeChatwootBridgeSession } from '@/components/storefront/ogabassey/components/chat/chatwoot-bridge-session';

type CartRef = { cartId: string; version: number } | null;

export async function authorizeCurrentChatwootInlineAction(input: {
  sessionToken: string;
  storeSlug: string;
  actionGeneration: number;
  getLatestActionGeneration: () => number;
  requestedCartRef: CartRef;
  getCurrentCartRef: () => CartRef;
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

  const currentCartRef = input.getCurrentCartRef();
  const actionStillCurrent =
    input.actionGeneration === input.getLatestActionGeneration() &&
    input.requestedCartRef !== null &&
    currentCartRef?.cartId === input.requestedCartRef.cartId &&
    currentCartRef.version === input.requestedCartRef.version &&
    authorized?.snapshot.cartVersion === currentCartRef.version;

  return { authorized, actionStillCurrent };
}
