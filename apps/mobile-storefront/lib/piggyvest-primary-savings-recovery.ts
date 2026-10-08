import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

export async function recoverPiggyvestPrimarySavings(input: {
  merchantId?: string;
  goalId: string;
}) {
  // Fresh client per operation: the factory caches the access token in a
  // closure, so a module-level singleton would keep serving the previous
  // user's Bearer [REDACTED] after an account switch.
  const client = createStorefrontCustomerApiClient();
  const parsed = schemas.recoveryRequest.parse(input);
  // Never translate a failed lookup into "no operation": the pending
  // endpoint answers SAVINGS_NOT_READY without consulting durable state,
  // so only a successful response may clear the client operation context.
  // Callers treat a throw as unknown and must block new contributions.
  const payload: unknown = await client.fetchJson({
    path: `/api/storefront/customer/savings/primary-transfer/pending?merchantId=${encodeURIComponent(parsed.merchantId)}&goalId=${encodeURIComponent(parsed.goalId)}`,
    method: 'GET',
  });
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
