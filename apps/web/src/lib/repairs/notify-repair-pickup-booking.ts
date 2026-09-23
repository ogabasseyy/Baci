import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyRepairBooking } from '@/lib/repair-notifications';

interface RepairPickupNotifyRow {
  ticket_number: number | string;
  customer_name: string;
  customer_email: string;
  device_type: string;
  device_model: string;
  pickup_address: string | null;
  quote_id: string | null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readTicketNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Best-effort merchant/customer notifications after a paid pickup is booked.
 * Mirrors the drop-off notify path in `createRepair` and the mobile book route.
 */
export async function notifyRepairPickupBookingAfterPayment(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string
): Promise<void> {
  const { data, error } = await supabase
    .from('repairs')
    .select(
      'ticket_number, customer_name, customer_email, device_type, device_model, pickup_address, quote_id'
    )
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (error || !data) {
    console.error('Repair pickup notify: repair lookup failed', error);
    return;
  }

  const row = data as RepairPickupNotifyRow;
  const ticketNumber = readTicketNumber(row.ticket_number);
  const customerName = readString(row.customer_name);
  const customerEmail = readString(row.customer_email);
  const deviceType = readString(row.device_type);
  const deviceModel = readString(row.device_model);
  if (
    !ticketNumber ||
    !customerName ||
    !customerEmail ||
    !deviceType ||
    !deviceModel
  ) {
    console.error('Repair pickup notify: repair snapshot incomplete', {
      repairId,
    });
    return;
  }

  await notifyRepairBooking({
    customerEmail,
    customerName,
    deviceModel,
    deviceType,
    merchantId,
    pickupAddress: row.pickup_address,
    quoteId: row.quote_id,
    repairId,
    serviceType: 'pickup',
    ticketNumber,
  });
}
