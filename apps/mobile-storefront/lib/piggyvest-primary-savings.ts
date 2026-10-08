import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const client = createStorefrontCustomerApiClient();

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
}
