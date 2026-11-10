import 'server-only';
import type { PiggyvestIntakeClient } from './intake-client.types';
import { createPiggyvestIntakeClientFromExecutor } from './webhook-intake-client';
import { createPiggyvestWebhookIntakeExecutor } from './webhook-intake-executor';
import { readPiggyvestWebhookIntakeRuntime } from './webhook-intake-runtime';

/**
 * PiggyVest webhook intake boundary.
 *
 * Only the HMAC-authenticated `/api/webhooks/piggyvest` route and the opt-in
 * capture replay adapter after complete stored-signature verification may call this.
 * The client reaches the database through the restricted login
 * `baci_piggyvest_webhook_intake` (EXECUTE on the `piggyvest_webhook_intake`
 * SECURITY DEFINER functions only, over verified TLS). It never uses the
 * Supabase service-role key and has no fallback: when the login settings are
 * missing or malformed this throws, and the receiver answers 503 with an
 * alert (the provider redelivers).
 *
 * The client is limited to the intake call graph: `recordPiggyvestEvent`,
 * `recordQuarantineEvent`, and `processPiggyvestEvent` (which fans out to the
 * inbox lease, inflow/interest ledgers, plan-wallet mapping, transfer outbox,
 * and restriction flips). Those entry points accept only this brand, so no
 * other edge can drive the money graph with a generic client.
 *
 * One client = one database connection (opened lazily, verified once, reused
 * by every operation of the delivery). The caller disposes it in a `finally`.
 */
export function createPiggyvestIntakeClient(
  env: NodeJS.ProcessEnv = process.env
): PiggyvestIntakeClient {
  return createPiggyvestIntakeClientFromExecutor(
    createPiggyvestWebhookIntakeExecutor(readPiggyvestWebhookIntakeRuntime(env))
  );
}

export type { PiggyvestIntakeClient } from './intake-client.types';
