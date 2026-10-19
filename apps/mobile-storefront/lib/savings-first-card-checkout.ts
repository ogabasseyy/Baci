import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { SavingsFirstCardCheckoutSchemas as schemas } from '@/schemas/savings-first-card-checkout';

const CHECKOUT_PATH = '/api/storefront/customer/savings/card-checkout';

function checkoutPath(goalId: string) {
  return `${CHECKOUT_PATH}?${new URLSearchParams({ goalId }).toString()}`;
}

export async function getSavingsFirstCardCapability({
  goalId,
  signal,
}: {
  goalId: string;
  signal?: AbortSignal;
}) {
  const data = await createStorefrontCustomerApiClient().fetchJson({
    path: checkoutPath(goalId),
    signal,
  });
  const capability = schemas.capability.parse(data);
  if (capability.goalId !== goalId)
    throw new Error('First-card capability does not match this plan.');
  return capability;
}

export async function startSavingsFirstCardCheckout({
  request,
  signal,
}: {
  request: unknown;
  signal?: AbortSignal;
}) {
  const body = schemas.request.parse(request);
  const data = await createStorefrontCustomerApiClient().fetchJson({
    body,
    includeCsrf: true,
    method: 'POST',
    path: CHECKOUT_PATH,
    signal,
  });
  return validateState(data, body.goalId, body.amountKobo);
}

export async function refreshSavingsFirstCardCheckout({
  selection,
  signal,
}: {
  selection: unknown;
  signal?: AbortSignal;
}) {
  const body = schemas.selection.parse(selection);
  const data = await createStorefrontCustomerApiClient().fetchJson({
    body,
    includeCsrf: true,
    method: 'PATCH',
    path: CHECKOUT_PATH,
    signal,
  });
  return validateState(data, body.goalId);
}

function validateState(data: unknown, goalId: string, amountKobo?: number) {
  const state = schemas.publicState.parse(data);
  if (
    state.goalId !== goalId ||
    (amountKobo !== undefined && state.amountKobo !== amountKobo)
  )
    throw new Error(
      'First-card checkout response does not match this request.'
    );
  return state;
}
