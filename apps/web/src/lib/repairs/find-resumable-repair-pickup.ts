import { matchesResumablePickupDetails } from '@/lib/repairs/matches-resumable-pickup-details';
import { createRepairPickupReceiverClient } from '@/lib/repairs/repair-pickup-receiver-client';
import { repairPickupResumeClaims } from '@/lib/repairs/repair-pickup-resume-claim';
import type { RepairBookingInput } from '@/lib/validations/repair';

type ResumableRepair = { success: true; id: string; ticketNumber: number };

type FindResumablePickupRepairResult =
  | { kind: 'found'; repair: ResumableRepair }
  | { kind: 'none' }
  | { kind: 'error'; error: string }
  | { kind: 'invalid_resume'; error: string };

type ResumablePickupRow = {
  id?: unknown;
  ticket_number?: unknown;
  customer_phone?: unknown;
  device_model?: unknown;
  device_type?: unknown;
  pickup_address?: unknown;
};

function parseResumableRow(
  row: unknown,
  expectedRepairId: string | null
): ResumableRepair | null {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const record = row as ResumablePickupRow;
  const ticketNumber =
    typeof record.ticket_number === 'number'
      ? record.ticket_number
      : Number(record.ticket_number);
  if (typeof record.id !== 'string' || !Number.isFinite(ticketNumber)) {
    return null;
  }
  if (expectedRepairId != null && record.id !== expectedRepairId) {
    return null;
  }
  return { success: true, id: record.id, ticketNumber };
}

/**
 * Reclaim an unpaid pickup with a signed resume capability, or — when no token
 * is present — the newest email-matched unpaid row only if device/phone/address
 * still match (blocks email-only takeover).
 */
export async function findResumablePickupRepair(options: {
  input: RepairBookingInput;
  merchantId: string;
  resumeToken: string | null | undefined;
  secret: string;
}): Promise<FindResumablePickupRepairResult> {
  const claim = repairPickupResumeClaims.verify(
    options.resumeToken,
    options.secret
  );
  const hasValidClaim =
    Boolean(claim) &&
    claim !== null &&
    claim.merchantId === options.merchantId &&
    claim.customerEmail === options.input.customerEmail.trim().toLowerCase();

  // Present-but-invalid tokens must fail closed — treating them as "none"
  // would create a duplicate repair instead of reclaiming the original.
  if (options.resumeToken && !hasValidClaim) {
    return {
      kind: 'invalid_resume',
      error:
        'Your saved pickup session is no longer valid. Start payment again from this page, or open the original link from your ticket email.',
    };
  }

  const pinnedRepairId = hasValidClaim && claim ? claim.repairId : null;

  const supabase = createRepairPickupReceiverClient(options.merchantId);
  const { data, error } = await supabase.rpc('find_resumable_repair_pickup', {
    p_merchant_id: options.merchantId,
    p_customer_email: options.input.customerEmail,
    p_repair_id: pinnedRepairId,
  });

  if (error) {
    console.error('Resumable repair pickup lookup failed:', error);
    return {
      kind: 'error',
      error:
        'We could not resume your saved pickup request. Please try again shortly.',
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const repair = parseResumableRow(row, pinnedRepairId);
  if (!repair || !row || typeof row !== 'object') {
    return { kind: 'none' };
  }

  if (
    !matchesResumablePickupDetails({
      input: options.input,
      saved: row as ResumablePickupRow,
    })
  ) {
    return { kind: 'none' };
  }

  return { kind: 'found', repair };
}
