import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceRoleKey } from '@/env';
import { logger } from '@/lib/logger';
import { createPaystackDvaReservationProof } from '@/lib/payments/paystack-dva-reservation-proof';
import type { Database } from '@/types/supabase';

export interface PaystackDvaAssignment {
  accountName: string;
  accountNumber: string;
  bankName: string;
  customerEmail: string;
  orderId: string;
  expiresAt?: string;
}

export interface PaystackDvaReservationResult {
  data: string | null;
  error: { message?: string } | null;
  proofError?: string;
}

export async function reservePaystackDvaAssignment(
  supabase: SupabaseClient<Database>,
  assignment: PaystackDvaAssignment
): Promise<PaystackDvaReservationResult> {
  const assignedAtMs = Date.now();
  const assignedAt = new Date(assignedAtMs).toISOString();
  const expiresAt =
    assignment.expiresAt ??
    new Date(assignedAtMs + 90 * 60 * 1000).toISOString();
  let provisioningProof: ReturnType<typeof createPaystackDvaReservationProof>;
  try {
    provisioningProof = createPaystackDvaReservationProof(
      {
        accountName: assignment.accountName,
        accountNumber: assignment.accountNumber,
        assignedAt,
        bankName: assignment.bankName,
        customerEmail: assignment.customerEmail,
        expiresAt,
        orderId: assignment.orderId,
      },
      { secret: getSupabaseServiceRoleKey() }
    );
  } catch (error) {
    logger.error({
      message: 'Paystack DVA reservation proof is unavailable',
      orderId: assignment.orderId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      data: null,
      error: null,
      proofError: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const { data, error } = await supabase.rpc(
    'reserve_paystack_order_payment_account',
    {
      p_account_name: assignment.accountName,
      p_account_number: assignment.accountNumber,
      p_assigned_at: assignedAt,
      p_bank_name: assignment.bankName,
      p_expires_at: expiresAt,
      p_expected_customer_email: assignment.customerEmail,
      p_order_id: assignment.orderId,
      p_provisioning_proof: provisioningProof,
    }
  );
  return { data, error };
}
