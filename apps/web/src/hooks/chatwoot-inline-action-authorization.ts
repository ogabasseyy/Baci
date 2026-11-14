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
  const initialCartRef = input.getCurrentCartRef();
  if (
    input.actionGeneration !== input.getLatestActionGeneration() ||
    input.requestedCartRef === null ||
    initialCartRef?.cartId !== input.requestedCartRef.cartId ||
    initialCartRef?.version !== input.requestedCartRef.version
  ) {
    return { authorized: null, actionStillCurrent: false };
  }

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
    currentCartRef?.version === input.requestedCartRef.version &&
    authorized?.cartId === currentCartRef.cartId &&
    authorized?.snapshot.cartVersion === currentCartRef.version;

  return { authorized, actionStillCurrent };
}
