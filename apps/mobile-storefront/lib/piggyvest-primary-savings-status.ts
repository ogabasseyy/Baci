import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

export async function checkPiggyvestPrimarySavingsStatus(input: {
  merchantId?: string;
  operationId: string;
}) {
  // Fresh client per operation: the factory caches the access token in a
  // closure, so a module-level singleton would keep serving the previous
  // user's Bearer [REDACTED] after an account switch.
  const client = createStorefrontCustomerApiClient();
  const body = schemas.statusRequest.parse(input);
  const result = schemas.statusResponse.safeParse(
    await client.fetchJson({
      path: '/api/storefront/customer/savings/primary-transfer',
      method: 'PATCH',
      includeCsrf: true,
      body,
    })
  );
  if (!result.success || result.data.operationId !== body.operationId)
    throw new Error(
      'Your contribution status could not be confirmed. Please refresh later.'
    );
  return result.data;
}
