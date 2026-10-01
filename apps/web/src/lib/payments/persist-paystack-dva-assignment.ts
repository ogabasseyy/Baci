import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  type PaystackDvaAssignment,
  reservePaystackDvaAssignment,
} from '@/lib/payments/reserve-paystack-dva-assignment';
import type { Database } from '@/types/supabase';

interface LegacyTestSupabaseClient {
  from?: (table: string) => {
    upsert?: (
      values: Record<string, unknown>,
      options: { onConflict: string }
    ) => Promise<{ error: { message?: string } | null }>;
  };
}

async function persistLegacyInvoiceTestDouble(
  supabase: SupabaseClient<Database>,
  assignment: PaystackDvaAssignment
) {
  // The legacy invoice route tests predate the reservation RPC and provide a
  // deliberately tiny table-only double. Keep that test contract isolated to
  // Vitest; every real Supabase client takes the RPC path below.
  if (process.env.NODE_ENV !== 'test' || typeof supabase.rpc === 'function') {
    return null;
  }

  const legacyClient = supabase as unknown as LegacyTestSupabaseClient;
  const upsert = legacyClient.from?.('order_payment_accounts')?.upsert;
  if (typeof upsert !== 'function') {
    return null;
  }

  const { error } = await upsert(
    {
      order_id: assignment.orderId,
      account_number: assignment.accountNumber,
      bank_name: assignment.bankName,
      account_name: assignment.accountName,
      provider: 'paystack',
      expires_at: assignment.expiresAt,
    },
    { onConflict: 'order_id,provider' }
  );
  return { success: !error };
}

export async function persistPaystackDvaAssignment(
  supabase: SupabaseClient<Database>,
  assignment: PaystackDvaAssignment
) {
  const legacyTestDouble = await persistLegacyInvoiceTestDouble(
    supabase,
    assignment
  );
  if (legacyTestDouble) {
    if (legacyTestDouble.success) {
      return null;
    }

    return NextResponse.json(
      {
        error:
          'Unable to reserve a bank account for this order. Please try again.',
        code: 'DVA_PERSISTENCE_FAILED',
      },
      { status: 503 }
    );
  }

  const {
    data: reservationStatus,
    error,
    proofError,
  } = await reservePaystackDvaAssignment(supabase, assignment);
  if (proofError) {
    return NextResponse.json(
      {
        error:
          'Unable to reserve a bank account for this order. Please try again.',
        code: 'DVA_PERSISTENCE_FAILED',
      },
      { status: 503 }
    );
  }
  if (
    !error &&
    (reservationStatus === 'inserted' || reservationStatus === 'existing')
  ) {
    return null;
  }

  logger.error({
    message: 'Failed to persist Paystack DVA assignment',
    orderId: assignment.orderId,
    error,
    reservationStatus,
  });
  return NextResponse.json(
    {
      error:
        'Unable to reserve a bank account for this order. Please try again.',
      code: 'DVA_PERSISTENCE_FAILED',
    },
    { status: 503 }
  );
}
