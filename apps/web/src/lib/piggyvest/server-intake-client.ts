import 'server-only';

import {
  createServiceClient,
  type PiggyvestIntakeServiceClient,
} from '@/lib/supabase/service';

/**
 * PiggyVest webhook intake boundary.
 *
 * Only the HMAC-authenticated `/api/webhooks/piggyvest` route may call this.
 * The client is limited to the intake call graph: `recordPiggyvestEvent`,
 * `recordQuarantineEvent`, and `processPiggyvestEvent` (which fans out to the
 * inbox lease, inflow/interest ledgers, plan-wallet mapping, transfer outbox,
 * and restriction flips). Those entry points accept only this brand, so no
 * other edge can drive the money graph with a generic service client.
 *
 * This brand confines the call graph at the type level. A dedicated
 * restricted database role (least-privilege intake grants instead of the
 * service-role key) plus owner exception approval remain required before
 * production activation.
 */
export function createPiggyvestIntakeServiceClient(): PiggyvestIntakeServiceClient {
  return createServiceClient('piggyvest-intake');
}

export type { PiggyvestIntakeServiceClient } from '@/lib/supabase/service';
