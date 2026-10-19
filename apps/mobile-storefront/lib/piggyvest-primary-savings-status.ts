import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { useAuthStore } from '@/stores/auth-store';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

export async function checkPiggyvestPrimarySavingsStatus(input: {
  merchantId?: string;
  operationId: string;
}) {
  // Fresh client per operation: the factory caches the access token in a
  // closure, so a module-level singleton would keep serving the previous
  // user's Bearer [REDACTED] after an account switch.
  const client = createStorefrontCustomerApiClient();
  // Pin the poll to the initiating user: without this, an account
  // switch mid-poll sends B's Bearer [REDACTED] for A's operation, and the
  // resulting CONTRIBUTION_NOT_FOUND clears the shared operation ref —
  // possibly discarding B's own pending handle. The pin fails locally
  // instead of querying under the wrong identity.
  const expectedUserId = useAuthStore.getState().user?.id;
  const body = schemas.statusRequest.parse(input);
  const result = schemas.statusResponse.safeParse(
    await client.fetchJson({
      path: '/api/storefront/customer/savings/primary-transfer',
      method: 'PATCH',
      includeCsrf: true,
      expectedUserId: expectedUserId ?? undefined,
      body,
    })
  );
  if (!result.success || result.data.operationId !== body.operationId)
    throw new Error(
      'Your contribution status could not be confirmed. Please refresh later.'
    );
  return result.data;
}
