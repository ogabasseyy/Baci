import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { isPrimaryWalletNotReady } from './piggyvest-primary-capability';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const client = createStorefrontCustomerApiClient();
export async function recoverPiggyvestPrimarySavings(input: {
  merchantId?: string;
  goalId: string;
}) {
  const parsed = schemas.recoveryRequest.parse(input);
  let payload: unknown;
  try {
    payload = await client.fetchJson({
      path: `/api/storefront/customer/savings/primary-transfer/pending?merchantId=${encodeURIComponent(parsed.merchantId)}&goalId=${encodeURIComponent(parsed.goalId)}`,
      method: 'GET',
    });
  } catch (error) {
    // Unconfigured primary has no pending operations to recover; report
    // none instead of surfacing a spurious recovery error.
    if (isPrimaryWalletNotReady(error)) return null;
    throw error;
  }
  const response = schemas.recoveryResponse.safeParse(payload);
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
