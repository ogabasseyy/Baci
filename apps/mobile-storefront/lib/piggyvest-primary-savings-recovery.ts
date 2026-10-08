import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const client = createStorefrontCustomerApiClient();
export async function recoverPiggyvestPrimarySavings(input: {
  merchantId?: string;
  goalId: string;
}) {
  const parsed = schemas.recoveryRequest.parse(input);
  const response = schemas.recoveryResponse.safeParse(
    await client.fetchJson({
      path: `/api/storefront/customer/savings/primary-transfer/pending?merchantId=${encodeURIComponent(parsed.merchantId)}&goalId=${encodeURIComponent(parsed.goalId)}`,
      method: 'GET',
    })
  );
  if (
    !response.success ||
    (response.data.operation &&
      response.data.operation.goalId !== parsed.goalId)
  )
    throw new Error(
      'Your pending contribution could not be recovered. Please refresh before making another payment.'
    );
  return response.data.operation;
}
