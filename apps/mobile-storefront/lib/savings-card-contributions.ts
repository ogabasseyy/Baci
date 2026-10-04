import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import {
  SavingsCardContributionOperationSchema,
  SavingsCardContributionOptionsSchema,
  SavingsCardContributionRequestSchema,
} from '@/schemas/savings-card-contributions';

const CONTRIBUTIONS_PATH =
  '/api/storefront/customer/savings/card-contributions';

function scopedPath(goalId: string, idempotencyKey?: string) {
  const query = new URLSearchParams({ goalId });
  if (idempotencyKey) query.set('idempotencyKey', idempotencyKey);
  return `${CONTRIBUTIONS_PATH}?${query.toString()}`;
}

export async function getSavingsCardContributionOptions({
  goalId,
  signal,
}: {
  goalId: string;
  signal?: AbortSignal;
}) {
  const data = await createStorefrontCustomerApiClient().fetchJson({
    path: scopedPath(goalId),
    signal,
  });
  const options = SavingsCardContributionOptionsSchema.parse(data);
  if (options.goalId !== goalId)
    throw new Error('Card contribution options do not match this plan.');
  return options;
}

export async function getSavingsCardContributionStatus({
  goalId,
  idempotencyKey,
  signal,
}: {
  goalId: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const data = await createStorefrontCustomerApiClient().fetchJson({
    path: scopedPath(goalId, idempotencyKey),
    signal,
  });
  const operation = SavingsCardContributionOperationSchema.parse(data);
  if (operation.goalId !== goalId)
    throw new Error('Card contribution status does not match this plan.');
  return operation;
}

export async function submitSavingsCardContribution({
  request,
  signal,
}: {
  request: {
    goalId: string;
    savedMethodId: string;
    amountKobo: number;
    idempotencyKey: string;
    consent: { version: 'prefunded-card-v1'; oneTimeCharge: true };
  };
  signal?: AbortSignal;
}) {
  const body = SavingsCardContributionRequestSchema.parse(request);
  const data = await createStorefrontCustomerApiClient().fetchJson({
    body,
    method: 'POST',
    path: CONTRIBUTIONS_PATH,
    signal,
  });
  const operation = SavingsCardContributionOperationSchema.parse(data);
  if (operation.goalId !== body.goalId || operation.amountKobo !== body.amountKobo)
    throw new Error('Card contribution response does not match this request.');
  return operation;
}
