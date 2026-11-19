import { SavingsPlanFundingResponseSchema } from '@/schemas/customer-savings';
import { PrimarySavingsPlanFundingSchemas as schemas } from '@/schemas/primary-savings-plan-funding';
import { useAuthStore } from '@/stores/auth-store';
import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
import {
  getPiggyvestPrimaryCapability,
  rollbackObservedCapabilityOnNotReady,
} from './piggyvest-primary-capability';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

export const PLAN_NOT_SET_UP_MESSAGE =
  'This plan account has not been set up yet.';

type Selection = {
  goalId: string;
  merchantId?: string | null;
  merchantSlug?: string | null;
  signal?: AbortSignal;
};

const PRIMARY_PROVISIONING_PATH =
  '/api/storefront/customer/savings/primary-provisioning';
export const PLAN_SETUP_UNAVAILABLE_MESSAGE =
  'Setup is not available for this goal right now.';

async function primaryFunding(
  input: Selection,
  interestAccepted?: boolean,
  expectedUserId?: string,
  setup: boolean | 'retry' = false
) {
  const selection = schemas.selection.parse({
    merchantId: input.merchantId,
    goalId: input.goalId,
  });
  // Per-operation client, like the other primary wallet clients: the
  // module singleton caches the first user's access token until expiry,
  // so an account switch would provision under the former customer.
  // The expected-user pin (captured by the caller before any await)
  // rejects locally when the session changed mid-flight instead of
  // sending A's goal under B's token (the route would scope it to B
  // and fail a legitimate request).
  const response = schemas.response.parse(
    await createStorefrontCustomerApiClient().fetchJson({
      path: setup
        ? `${PRIMARY_PROVISIONING_PATH}/setup`
        : PRIMARY_PROVISIONING_PATH,
      method: interestAccepted === undefined && !setup ? 'PATCH' : 'POST',
      includeCsrf: true,
      signal: input.signal,
      expectedUserId: expectedUserId ?? undefined,
      body: setup
        ? setup === 'retry'
          ? schemas.setupRetryRequest.parse(selection)
          : schemas.setupRequest.parse({ ...selection, interestAccepted })
        : interestAccepted === undefined
          ? selection
          : schemas.request.parse({
              ...selection,
              consent: true,
              interestAccepted,
            }),
    })
  );
  if (response.goalId !== selection.goalId)
    throw new Error('Could not confirm this plan account.');
  if (response.status === 'conflict')
    throw new Error(
      'This plan account needs review. Please contact support before trying again.'
    );
  if (response.status === 'not_found')
    // Same code as the legacy 404, so callers read 'never set up' alike.
    throw Object.assign(new Error(PLAN_NOT_SET_UP_MESSAGE), {
      code: 'SAVINGS_WALLET_NOT_FOUND',
    });
  return SavingsPlanFundingResponseSchema.parse(response);
}

async function resolvePrimaryRail(merchantId?: string | null) {
  // Pilot and previously observed merchants skip the probe; every other
  // identified merchant probes first so a cold start at a rolled-out
  // merchant routes to primary instead of silently falling back to
  // legacy. An ambiguous probe failure rejects (never legacy-fallbacks)
  // so funding never misroutes on an ambiguous error.
  if (isPiggyvestPrimaryMerchant(merchantId)) return true;
  if (!merchantId) return false;
  return await getPiggyvestPrimaryCapability(merchantId);
}

export const customerSavingsPlanFunding = {
  async provision(
    input: Selection & { bvn: string; enableInterestAccrual?: boolean }
  ) {
    // Capture the initiating user before the awaited rail probe: a
    // switch landing mid-probe must fail locally under A's pin, not
    // re-capture B and submit A's goal under B's session.
    const expectedUserId = useAuthStore.getState().user?.id;
    if (await resolvePrimaryRail(input.merchantId)) {
      try {
        return await primaryFunding(
          input,
          input.enableInterestAccrual === true,
          expectedUserId
        );
      } catch (error) {
        if (!rollbackObservedCapabilityOnNotReady(input.merchantId, error))
          throw error;
      }
    }
    const client = createStorefrontCustomerApiClient();
    return SavingsPlanFundingResponseSchema.parse(
      await client.fetchJson({
        body: {
          bvn: input.bvn,
          goalId: input.goalId,
          ...(input.enableInterestAccrual === true
            ? { enableInterestAccrual: true }
            : {}),
        },
        method: 'POST',
        path: '/api/storefront/customer/savings/funding',
        query: client.buildMerchantIdentifiers(input),
        signal: input.signal,
        expectedUserId: expectedUserId ?? undefined,
      })
    );
  },
  /**
   * Finishes setup of an existing goal that was never provisioned. Primary
   * rail only (there is no legacy equivalent), and the interest answer is
   * required: nothing here supplies a default.
   */
  async setup(input: Selection & { interestAccepted: boolean }) {
    const expectedUserId = useAuthStore.getState().user?.id;
    if (!(await resolvePrimaryRail(input.merchantId)))
      throw new Error(PLAN_SETUP_UNAVAILABLE_MESSAGE);
    return await primaryFunding(
      input,
      input.interestAccepted,
      expectedUserId,
      true
    );
  },
  /**
   * Re-runs setup for a goal whose earlier attempt stalled and whose claim
   * has expired (the status read says setupRetryable). No interest answer is
   * sent: the server reuses the one stored for the goal, and a live claim is
   * never replaced.
   */
  async retrySetup(input: Selection) {
    const expectedUserId = useAuthStore.getState().user?.id;
    if (!(await resolvePrimaryRail(input.merchantId)))
      throw new Error(PLAN_SETUP_UNAVAILABLE_MESSAGE);
    return await primaryFunding(input, undefined, expectedUserId, 'retry');
  },
  async recover(input: Selection) {
    // Same entry capture as provision: the status read must not run
    // under a user who signed in after the action began.
    const expectedUserId = useAuthStore.getState().user?.id;
    if (await resolvePrimaryRail(input.merchantId)) {
      try {
        return await primaryFunding(input, undefined, expectedUserId);
      } catch (error) {
        if (!rollbackObservedCapabilityOnNotReady(input.merchantId, error))
          throw error;
      }
    }
    const client = createStorefrontCustomerApiClient();
    return SavingsPlanFundingResponseSchema.parse(
      await client.fetchJson({
        method: 'GET',
        path: '/api/storefront/customer/savings/funding',
        query: {
          goalId: input.goalId,
          ...client.buildMerchantIdentifiers(input),
        },
        signal: input.signal,
        expectedUserId: expectedUserId ?? undefined,
      })
    );
  },
};
