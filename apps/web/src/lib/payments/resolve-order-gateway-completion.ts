import type { SupabaseClient } from '@supabase/supabase-js';
import { completeOrderGatewayPayment } from './complete-order-gateway-payment';
import { captureOrHoldRedvaultPayment } from './redvault-capture-hold';
import { verifyAndCompleteRedvaultPayment } from './verify-and-complete-redvault-payment';

export async function resolveOrderGatewayCompletion({
  actor,
  gateway,
  gatewayResponse,
  merchantId,
  orderId,
  reference,
  supabase,
  transactionId,
}: {
  actor: string;
  gateway: 'juicyway' | 'paystack' | 'korapay';
  gatewayResponse: Record<string, unknown>;
  merchantId: string;
  orderId: string;
  reference: string;
  supabase: SupabaseClient;
  transactionId: string;
}) {
  try {
    const capture = await captureOrHoldRedvaultPayment({
      gateway,
      gatewayResponse,
      orderId,
      reference,
      supabase,
      transactionId,
    });
    if (capture.kind !== 'not_redvault') {
      if (capture.kind === 'captured_held' && gateway === 'paystack') {
        const approved = await verifyAndCompleteRedvaultPayment({
          merchantId,
          orderId,
          reference,
          supabase,
          transactionId,
        });
        if (approved) {
          const completion = approved.duplicate
            ? {
                ...approved.completion,
                already_completed: true,
                order_already_paid: true,
                order_updated: false,
              }
            : approved.completion;
          return {
            ok: true as const,
            completion,
            redvaultDuplicate: approved.duplicate,
            redvaultInventoryConfirmed: approved.inventoryConfirmed,
          };
        }
      }
      return { ok: false as const, outcome: capture };
    }
  } catch (error) {
    return {
      ok: false as const,
      outcome: { error, kind: 'capture_hold_failed' as const },
    };
  }
  const result = await completeOrderGatewayPayment({
    actor,
    gatewayResponse,
    orderId,
    supabase,
    transactionId,
  });
  if (!result.ok || result.completion.error_code) {
    return {
      ok: false as const,
      outcome: {
        error: result.ok ? result.completion : result.error,
        kind: 'completion_failed' as const,
      },
    };
  }
  return {
    ...result,
    redvaultDuplicate: false,
    redvaultInventoryConfirmed: false,
  };
}
