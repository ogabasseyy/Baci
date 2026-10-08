import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const client = createStorefrontCustomerApiClient();
export async function checkPiggyvestPrimarySavingsStatus(input: {
  merchantId?: string;
  operationId: string;
}) {
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
