import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { bookRepairPickup } from '@/lib/repairs/book-repair-pickup';
import { authorizeRepairsRequest } from '@/lib/repairs/catalog-admin-auth';
import { REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS } from '@/lib/repairs/repair-pickup-constants';
import { createClient } from '@/lib/supabase/admin';
import { repairPickupRequestSchema } from '@/schemas/repair-bookings';

const idSchema = z.uuid();

type RouteContext = { params: Promise<{ id: string }> };

type ManualPickupOutcome = 'recorded' | 'not_found' | 'conflict' | 'error';

function isActivePickupBookingLock(
  lockToken: unknown,
  startedAt: unknown,
  nowMs = Date.now()
): boolean {
  if (typeof lockToken !== 'string' || lockToken.length === 0) return false;
  if (typeof startedAt !== 'string' || startedAt.length === 0) return false;
  const startedMs = Date.parse(startedAt);
  if (Number.isNaN(startedMs)) return false;
  return nowMs - startedMs < REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS * 1000;
}

/**
 * Records a manual pickup arrangement (the merchant handles logistics offline)
 * by appending an admin note. Used as the fallback when courier booking is
 * unavailable.
 *
 * Refuses while a shipment is linked or an automatic booking lock is active so
 * merchants cannot race a webhook/provider booking into dual fulfillment.
 */
async function recordManualPickup(
  supabase: SupabaseClient,
  merchantId: string,
  repairId: string
): Promise<ManualPickupOutcome> {
  const { data, error } = await supabase
    .from('repairs')
    .select(
      'admin_notes, shipment_id, pickup_booking_lock_token, pickup_booking_started_at, service_type'
    )
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (error) {
    logger.error({
      message: 'recordManualPickup: booking lookup failed',
      repairId,
      merchantId,
      error,
    });
    return 'error';
  }
  if (!data) {
    return 'not_found';
  }

  const row = data as {
    admin_notes?: unknown;
    shipment_id?: unknown;
    pickup_booking_lock_token?: unknown;
    pickup_booking_started_at?: unknown;
    service_type?: unknown;
  };
  if (row.service_type !== 'pickup') {
    return 'not_found';
  }
  if (typeof row.shipment_id === 'string' && row.shipment_id.length > 0) {
    return 'conflict';
  }
  if (
    isActivePickupBookingLock(
      row.pickup_booking_lock_token,
      row.pickup_booking_started_at
    )
  ) {
    return 'conflict';
  }

  const existing =
    typeof row.admin_notes === 'string' ? (row.admin_notes as string) : '';
  const note = `${existing ? `${existing}\n` : ''}[${new Date().toISOString()}] Pickup arranged manually.`;
  const staleCutoff = new Date(
    Date.now() - REPAIR_PICKUP_LOCK_TIMEOUT_SECONDS * 1000
  ).toISOString();

  // Terminal `manual_fulfilled` stops Paystack webhook rebooking and blocks
  // further GIGL auto booking (distinct from payment-side `review`). Guard the
  // write so a concurrent provider link / active lock loses the race cleanly.
  // Include NULL pickup_payment_status so grandfathered rows still update
  // (PostgreSQL `status IN (...)` / neq alone rejects NULL).
  const { data: updated, error: updateError } = await supabase
    .from('repairs')
    .update({
      admin_notes: note,
      pickup_payment_status: 'manual_fulfilled',
      pickup_booking_lock_token: null,
      pickup_booking_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', repairId)
    .eq('merchant_id', merchantId)
    .eq('service_type', 'pickup')
    .is('shipment_id', null)
    .or(
      'pickup_payment_status.is.null,and(pickup_payment_status.neq.booked,pickup_payment_status.neq.manual_fulfilled)'
    )
    .or(
      `pickup_booking_lock_token.is.null,pickup_booking_started_at.is.null,pickup_booking_started_at.lt.${staleCutoff}`
    )
    .select('id')
    .maybeSingle();

  if (updateError) {
    logger.error({
      message: 'recordManualPickup: note write failed',
      repairId,
      merchantId,
      error: updateError,
    });
    return 'error';
  }
  if (!updated) {
    return 'conflict';
  }

  return 'recorded';
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const authz = await authorizeRepairsRequest(request, 'edit');
  if (!authz.ok) {
    return authz.response;
  }

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid booking id' }, { status: 400 });
  }

  // An empty body is valid (mode defaults to 'auto'); malformed JSON is not —
  // otherwise bad input silently books a paid GIGL pickup instead of 400ing.
  let body: unknown = {};
  const rawBody = await request.text();
  if (rawBody.trim().length > 0) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  const parsed = repairPickupRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  if (parsed.data.mode === 'manual') {
    const outcome = await recordManualPickup(
      authz.supabase,
      authz.access.merchantId,
      id
    );
    if (outcome === 'not_found') {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    if (outcome === 'conflict') {
      return NextResponse.json(
        {
          error:
            'Automatic pickup booking is already linked or in progress. Refresh and try again.',
        },
        { status: 409 }
      );
    }
    if (outcome === 'error') {
      return NextResponse.json(
        { error: 'Failed to record manual pickup' },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, manual: true });
  }

  const admin = createClient();
  const result = await bookRepairPickup(admin, authz.access.merchantId, id);
  if (!result.ok && result.reason === 'not_found') {
    return NextResponse.json({ error: result.message }, { status: 404 });
  }

  return NextResponse.json({ result });
}
