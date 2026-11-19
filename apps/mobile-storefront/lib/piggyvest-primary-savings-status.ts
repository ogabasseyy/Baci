import { PiggyvestPrimarySavingsSchemas as schemas } from '@/schemas/piggyvest-primary-savings';
import { useAuthStore } from '@/stores/auth-store';
import { TimeoutError } from './fetch-with-timeout';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

/**
 * One deadline for the whole status read: the session token, the CSRF token
 * (its body too) and the PATCH. Without it a stalled step left the check
 * running forever, so the app never asked again (incident 2026-11-17).
 */
export const PRIMARY_SAVINGS_STATUS_DEADLINE_MS = 15_000;

export async function checkPiggyvestPrimarySavingsStatus(input: {
  merchantId?: string;
  operationId: string;
}) {
  // Fresh client per operation: the factory caches the access token in a
  // closure, so a module-level singleton would keep serving the previous
  // user's Bearer [REDACTED] after an account switch.
  const client = createStorefrontCustomerApiClient();
  // Pin the poll to the initiating user: without this, an account
  // switch mid-poll sends B's Bearer [REDACTED] for A's operation, and the
  // resulting CONTRIBUTION_NOT_FOUND clears the shared operation ref —
  // possibly discarding B's own pending handle. The pin fails locally
  // instead of querying under the wrong identity.
  const expectedUserId = useAuthStore.getState().user?.id;
  const body = schemas.statusRequest.parse(input);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(PRIMARY_SAVINGS_STATUS_DEADLINE_MS));
    }, PRIMARY_SAVINGS_STATUS_DEADLINE_MS);
  });
  let response: unknown;
  try {
    // A read only: giving up on it at the deadline leaves the operation
    // pending (the caller keeps it and asks again later).
    response = await Promise.race([
      client.fetchJson({
        path: '/api/storefront/customer/savings/primary-transfer',
        method: 'PATCH',
        includeCsrf: true,
        expectedUserId: expectedUserId ?? undefined,
        body,
        signal: controller.signal,
        timeoutMs: PRIMARY_SAVINGS_STATUS_DEADLINE_MS,
      }),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
  const result = schemas.statusResponse.safeParse(response);
  if (!result.success || result.data.operationId !== body.operationId)
    throw new Error(
      'Your contribution status could not be confirmed. Please refresh later.'
    );
  return result.data;
}
