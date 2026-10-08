import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { addSavingsContribution } from './customer-savings';
import { rollbackObservedCapabilityOnNotReady } from './piggyvest-primary-capability';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

export async function addPiggyvestPrimarySavingsContribution(input: {
  amount: number;
  goalId: string;
  idempotencyKey: string;
  merchantId?: string;
  merchantSlug?: string;
}) {
  const amountKobo = Math.round(input.amount * 100);
  if (
    !Number.isFinite(input.amount) ||
    Math.abs(input.amount * 100 - amountKobo) > 0.000001
  )
    throw new Error('Enter an amount with no more than two decimal places.');
  const body = schemas.request.parse({
    merchantId: input.merchantId,
    goalId: input.goalId,
    operationId: input.idempotencyKey,
    amountKobo,
  });
  // Fresh client per operation: the factory caches the access token in a
  // closure, so a module-level singleton would keep serving the previous
  // user's Bearer [REDACTED] after an account switch.
  const client = createStorefrontCustomerApiClient();
  try {
    const response = schemas.response.safeParse(
      await client.fetchJson({
        path: '/api/storefront/customer/savings/primary-transfer',
        method: 'POST',
        includeCsrf: true,
        body,
      })
    );
    if (!response.success || response.data.operationId !== body.operationId)
      throw new Error(
        'Your contribution could not be confirmed. Check its status before trying again.'
      );
    return response.data;
  } catch (error) {
    // The server positively reports primary savings as unconfigured: route
    // the contribution through the working legacy flow instead of failing.
    if (!rollbackObservedCapabilityOnNotReady(input.merchantId, error))
      throw error;
    return addSavingsContribution({
      amount: input.amount,
      goalId: input.goalId,
      idempotencyKey: input.idempotencyKey,
      merchantId: input.merchantId,
      merchantSlug: input.merchantSlug,
    });
  }
}
