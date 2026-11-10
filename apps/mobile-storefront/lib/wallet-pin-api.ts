import { WalletPinSchemas as schemas } from '@/schemas/wallet-pin';
import { useAuthStore } from '@/stores/auth-store';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const SERVER_REPLY_UNREADABLE = 'Wallet PIN is unavailable right now.';

// A fresh client per call: the factory caches the access token in a closure.
// Every call is pinned to the signed-in user so an account switch mid-flight
// fails locally instead of sending the PIN under another identity. The PIN is
// only ever placed in a request body here; it is never logged or stored.
function begin(pinnedUserId?: string) {
  return {
    client: createStorefrontCustomerApiClient(),
    // The account that opened the PIN sheet wins over whoever is signed in
    // now, so a switch while the sheet is open fails locally.
    expectedUserId:
      pinnedUserId ?? useAuthStore.getState().user?.id ?? undefined,
  };
}

export async function fetchWalletPinStatus(pinnedUserId?: string) {
  const { client, expectedUserId } = begin(pinnedUserId);
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
export async function submitWalletPin(
  kind: 'set' | 'reset',
  pin: string,
  pinnedUserId?: string
) {
  const { client, expectedUserId } = begin(pinnedUserId);
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
export async function verifyFundPin(
  input: {
    merchantId: string;
    pin: string;
    goalId: string;
    operationId: string;
    amountKobo: number;
  },
  pinnedUserId?: string
) {
  const { client, expectedUserId } = begin(pinnedUserId);
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

/** Single-use proof bound to this goal and operation (cancel or complete). */
export async function verifyGoalActionPin(
  input: {
    merchantId: string;
    pin: string;
    action: 'cancel' | 'complete';
    goalId: string;
    operationId: string;
  },
  pinnedUserId?: string
) {
  const { client, expectedUserId } = begin(pinnedUserId);
  const body = schemas.goalActionVerifyRequest.parse(input);
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
