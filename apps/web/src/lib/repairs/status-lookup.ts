import type { SupabaseClient } from '@supabase/supabase-js';
import { isRepairStatus, type RepairStatus } from '@/lib/repairs/repair-status';

/**
 * Customer-facing repair status (nothing internal like cost/notes). Returned by
 * the enumeration-safe lookup and rendered on the public status page.
 */
export interface RepairStatusResult {
  ticketNumber: number;
  status: RepairStatus;
  deviceLabel: string;
  repairTypeLabel: string | null;
  serviceType: 'dropoff' | 'pickup';
  createdAt: string;
  updatedAt: string;
  trackingNumber: string | null;
  pickupPaymentStatus: string | null;
  pickupFee: number | null;
  pickupCurrency: string | null;
}

export type RepairStatusLookupOutcome =
  | { found: true; result: RepairStatusResult }
  | { found: false };

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Looks up a repair via the SECURITY DEFINER get_repair_status RPC. The RPC
 * enforces the merchant + ticket + email match, so a mismatch and a
 * non-existent ticket both return { found: false } — identical to the caller,
 * preserving the enumeration guard.
 */
export async function lookupRepairStatus(
  supabase: SupabaseClient,
  merchantId: string,
  ticketNumber: number,
  email: string
): Promise<RepairStatusLookupOutcome> {
  const { data, error } = await supabase.rpc('get_repair_status', {
    p_merchant_id: merchantId,
    p_ticket_number: ticketNumber,
    p_email: email,
  });

  if (error) {
    console.error('Repair status lookup failed:', error);
    return { found: false };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') {
    return { found: false };
  }

  const record = row as Record<string, unknown>;
  if (!isRepairStatus(record.status)) {
    return { found: false };
  }

  const deviceType =
    typeof record.device_type === 'string' ? record.device_type : '';
  const deviceModel =
    typeof record.device_model === 'string' ? record.device_model : '';

  return {
    found: true,
    result: {
      ticketNumber: Number(record.ticket_number),
      status: record.status,
      deviceLabel: `${deviceType} ${deviceModel}`.trim() || 'Device',
      repairTypeLabel:
        typeof record.repair_type_label === 'string'
          ? record.repair_type_label
          : null,
      serviceType: record.service_type === 'pickup' ? 'pickup' : 'dropoff',
      createdAt: String(record.created_at ?? ''),
      updatedAt: String(record.updated_at ?? ''),
      trackingNumber:
        typeof record.tracking_number === 'string'
          ? record.tracking_number
          : null,
      pickupPaymentStatus:
        typeof record.pickup_payment_status === 'string'
          ? record.pickup_payment_status
          : null,
      pickupFee: toFiniteNumber(record.pickup_fee),
      pickupCurrency:
        typeof record.pickup_currency === 'string'
          ? record.pickup_currency
          : null,
    },
  };
}
