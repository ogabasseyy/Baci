import {
  type GoalActionKind,
  GoalLifecycleSchemas as schemas,
} from '@/schemas/goal-lifecycle';
import { useAuthStore } from '@/stores/auth-store';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

export const GOAL_ACTION_UNREADABLE =
  'We could not confirm this. Check its status before trying again.';

// A fresh client per call (the factory caches the access token in a
// closure), pinned to the signed-in user so an account switch mid-flight
// fails locally instead of acting under another identity.
function begin(pinnedUserId?: string) {
  return {
    client: createStorefrontCustomerApiClient(),
    expectedUserId:
      pinnedUserId ?? useAuthStore.getState().user?.id ?? undefined,
  };
}

const pathOf = (kind: GoalActionKind) =>
  `/api/storefront/customer/savings/goal-${kind}`;

// The in-sheet cancel step tells the customer an early cancel forfeits the
// goal's interest, so it says so to the server (older screens never did).
const disclosure = (kind: GoalActionKind) =>
  kind === 'cancel' ? { interestForfeitAcknowledged: true as const } : {};

// An unreadable reply is indeterminate: no code, and never a reason to resend.
function unreadable() {
  return new Error(GOAL_ACTION_UNREADABLE);
}

/** Asks the server for an operation id (or the live one for this goal). */
export async function issueGoalAction(
  kind: GoalActionKind,
  input: { merchantId: string; goalId: string },
  pinnedUserId?: string
) {
  const { client, expectedUserId } = begin(pinnedUserId);
  const body = schemas.issueRequest.parse({
    step: 'issue',
    ...input,
    ...disclosure(kind),
  });
  const result = schemas.issueResponse[kind].safeParse(
    await client.fetchJson({
      path: pathOf(kind),
      method: 'POST',
      includeCsrf: true,
      expectedUserId,
      body,
    })
  );
  if (!result.success) throw unreadable();
  return result.data;
}

/** Moves the whole goal. Never call this twice for one operation id. */
export async function submitGoalAction(
  kind: GoalActionKind,
  input: {
    merchantId: string;
    goalId: string;
    operationId: string;
    pinProof: string;
  },
  pinnedUserId?: string
) {
  const { client, expectedUserId } = begin(pinnedUserId);
  const body = schemas.submitRequest.parse({
    step: 'submit',
    ...input,
    ...disclosure(kind),
  });
  const result = schemas.submitResponse.safeParse(
    await client.fetchJson({
      path: pathOf(kind),
      method: 'POST',
      includeCsrf: true,
      expectedUserId,
      body,
    })
  );
  if (!result.success || result.data.operationId !== input.operationId)
    throw unreadable();
  return result.data;
}

/** Reads what became of an operation; the only retry-safe call. */
export async function checkGoalActionStatus(
  kind: GoalActionKind,
  input: { merchantId: string; operationId: string },
  pinnedUserId?: string
) {
  const { client, expectedUserId } = begin(pinnedUserId);
  const body = schemas.statusRequest.parse(input);
  const result = schemas.statusResponse.safeParse(
    await client.fetchJson({
      path: pathOf(kind),
      method: 'PATCH',
      includeCsrf: true,
      expectedUserId,
      body,
    })
  );
  if (!result.success || result.data.operationId !== input.operationId)
    throw unreadable();
  return result.data;
}
