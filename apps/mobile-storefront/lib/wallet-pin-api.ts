import { WalletPinSchemas as schemas } from '@/schemas/wallet-pin';
import { useAuthStore } from '@/stores/auth-store';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const SERVER_REPLY_UNREADABLE = 'Wallet PIN is unavailable right now.';

// A fresh client per call: the factory caches the access token in a closure.
// Every call is pinned to the signed-in user so an account switch mid-flight
// fails locally instead of sending the PIN under another identity. The PIN is
// only ever placed in a request body here; it is never logged or stored.
function begin() {
  return {
    client: createStorefrontCustomerApiClient(),
    expectedUserId: useAuthStore.getState().user?.id ?? undefined,
  };
}

export async function fetchWalletPinStatus() {
  const { client, expectedUserId } = begin();
  const result = schemas.status.safeParse(
    await client.fetchJson({
      path: '/api/storefront/customer/wallet-pin/status',
      expectedUserId,
    })
  );
  if (!result.success) throw new Error(SERVER_REPLY_UNREADABLE);
  return result.data;
}

/** First PIN ('set') or a replacement after a required reset ('reset'). */
export async function submitWalletPin(kind: 'set' | 'reset', pin: string) {
  const { client, expectedUserId } = begin();
  const body = schemas.setRequest.parse({ pin });
  const result = schemas.setResponse.safeParse(
    await client.fetchJson({
      path: `/api/storefront/customer/wallet-pin/${kind}`,
      method: 'POST',
      includeCsrf: true,
      expectedUserId,
      body,
    })
  );
  if (!result.success) throw new Error(SERVER_REPLY_UNREADABLE);
}

/** Returns the single-use proof bound to this goal, operation and amount. */
export async function verifyFundPin(input: {
  merchantId: string;
  pin: string;
  goalId: string;
  operationId: string;
  amountKobo: number;
}) {
  const { client, expectedUserId } = begin();
  const body = schemas.fundVerifyRequest.parse({ ...input, action: 'fund' });
  const result = schemas.fundVerifyResponse.safeParse(
    await client.fetchJson({
      path: '/api/storefront/customer/savings/goal-pin/verify',
      method: 'POST',
      includeCsrf: true,
      expectedUserId,
      body,
    })
  );
  if (!result.success) throw new Error(SERVER_REPLY_UNREADABLE);
  return result.data.proof;
}
