import { WalletPinChangeSchemas as schemas } from '@/schemas/wallet-pin-change';
import { useAuthStore } from '@/stores/auth-store';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const SERVER_REPLY_UNREADABLE = 'Wallet PIN is unavailable right now.';

/**
 * Replace the PIN while proving the old one. Built like submitWalletPin: a
 * fresh client per call, pinned to the signed-in user so an account switch
 * mid-flight fails locally. The PINs only ever live in the request body; they
 * are never logged, stored or placed in an error message.
 */
export async function changeWalletPin(
  input: { currentPin: string; newPin: string },
  pinnedUserId?: string
) {
  const client = createStorefrontCustomerApiClient();
  const expectedUserId =
    pinnedUserId ?? useAuthStore.getState().user?.id ?? undefined;
  const parsed = schemas.request.safeParse(input);
  if (!parsed.success) throw new Error(SERVER_REPLY_UNREADABLE);
  const result = schemas.response.safeParse(
    await client.fetchJson({
      path: '/api/storefront/customer/wallet-pin/change',
      method: 'POST',
      includeCsrf: true,
      expectedUserId,
      body: parsed.data,
    })
  );
  if (!result.success) throw new Error(SERVER_REPLY_UNREADABLE);
}
