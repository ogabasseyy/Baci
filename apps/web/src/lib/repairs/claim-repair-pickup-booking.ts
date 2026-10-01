import type { SupabaseClient } from '@supabase/supabase-js';
import { REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS } from './repair-pickup-constants';

interface RepairPickupClaimRow {
  claimed: boolean;
  shipment_id: string | null;
  terminal?: boolean | null;
}

export type RepairPickupClaimResult =
  | { status: 'claimed'; lockToken: string }
  | { status: 'already_booked' }
  | { status: 'booking_in_progress' }
  | { status: 'terminal' }
  | { status: 'not_found' }
  | { status: 'failed' };

function getClaimRow(
  value: RepairPickupClaimRow[] | RepairPickupClaimRow | null
): RepairPickupClaimRow | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function claimRepairPickupBooking(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string
): Promise<RepairPickupClaimResult> {
  const lockToken = crypto.randomUUID();
  const { data, error } = await supabase.rpc('claim_repair_pickup_booking', {
    p_repair_id: repairId,
    p_merchant_id: merchantId,
    p_lock_token: lockToken,
    p_lock_timeout_seconds: REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS,
  });

  if (error) {
    console.error('Failed to claim repair pickup booking:', error);
    return { status: 'failed' };
  }

  const row = getClaimRow(
    data as RepairPickupClaimRow[] | RepairPickupClaimRow | null
  );
  if (!row) return { status: 'not_found' };
  if (row.claimed) return { status: 'claimed', lockToken };
  if (row.terminal) return { status: 'terminal' };
  if (row.shipment_id) return { status: 'already_booked' };
  return { status: 'booking_in_progress' };
}
