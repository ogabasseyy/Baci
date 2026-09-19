import type { SupabaseClient } from '@supabase/supabase-js';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import { completeOrderGatewayPayment } from './complete-order-gateway-payment';
import { fileRedvaultInventoryConfirmationReview } from './file-redvault-inventory-confirmation-review';
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
    // Capture moves money and must not ride the route's service-role client:
    // it runs through the short-lived scoped route client (merchant-bound
    // authenticated claims), which the capture RPCs accept alongside
    // service_role. The order read below keeps the route client.
    const redvaultScopedClient = createStorefrontOrderRpcClient({
      fallbackClient: supabase,
      hasCanonicalDeliveryMetadata: false,
      merchantId,
      userId: null,
    });
    const capture = await captureOrHoldRedvaultPayment({
      gateway,
      gatewayResponse,
      orderId,
      reference,
      rpcClient: redvaultScopedClient,
      supabase,
      transactionId,
    });
    if (capture.kind !== 'not_redvault') {
      if (
        (capture.kind === 'captured_held' ||
          capture.kind === 'capture_evidence_review') &&
        gateway === 'paystack'
      ) {
        if (capture.kind === 'capture_evidence_review') {
          await fileRedvaultInventoryConfirmationReview({
            gatewayReference: reference,
            merchantId,
            metadata: { reason: capture.reason },
            orderId,
            reason: `REDVAULT capture evidence requires review: ${capture.reason}`,
            supabase: redvaultScopedClient,
            transactionId,
          });
          return { ok: false as const, outcome: capture };
        }
        // Approval moves money and must not ride the route's service-role
        // client: verification context + approval run through the
        // short-lived scoped route client (merchant-bound authenticated
        // claims), which those RPCs accept alongside service_role.
        const approved = await verifyAndCompleteRedvaultPayment({
          merchantId,
          orderId,
          reference,
          supabase: redvaultScopedClient,
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
        await fileRedvaultInventoryConfirmationReview({
          gatewayReference: reference,
          merchantId,
          metadata: { reason: capture.reason },
          orderId,
          reason: `REDVAULT capture held: ${capture.reason}`,
          supabase: redvaultScopedClient,
          transactionId,
        });
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
