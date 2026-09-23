import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createScopedClient } from '@/lib/supabase/scoped';
import { signScopedSupabaseJwt } from '@/lib/supabase/scoped-jwt';

const REPAIR_PICKUP_RECEIVER_TTL_SECONDS = 60;

export type RepairPickupReceiverContext = 'server-quote' | 'server-fulfillment';

export function createRepairPickupReceiverClient(
  merchantId: string,
  now = new Date(),
  context: RepairPickupReceiverContext = 'server-quote'
): SupabaseClient {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const token = signScopedSupabaseJwt({
    aud: 'authenticated',
    exp: issuedAt + REPAIR_PICKUP_RECEIVER_TTL_SECONDS,
    iat: issuedAt,
    jti: crypto.randomUUID(),
    repair_pickup_receiver_context: context,
    repair_pickup_receiver_merchant_id: merchantId,
    role: 'repair_pickup_receiver',
  });

  return createScopedClient(token);
}
