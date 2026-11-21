import type { SupabaseClient } from '@supabase/supabase-js';
import { createStorefrontOrderRpcClient } from '@/lib/checkout/storefront-order-rpc-client';
import type { BankCardOfferTerminalStatus } from '@/schemas/bank-card-offer-terminal-status';
import { approveBankCardOfferPayment } from './approve-bank-card-offer-payment';
import { completeOrderGatewayPayment } from './complete-order-gateway-payment';
import { fileRedvaultInventoryConfirmationReview } from './file-redvault-inventory-confirmation-review';
import { captureOrHoldRedvaultPayment } from './redvault-capture-hold';
import { verifyAndCompleteRedvaultPayment } from './verify-and-complete-redvault-payment';

export async function resolveOrderGatewayCompletion({
  actor,
  expectedBankOfferTerminalStatus,
  expectedOutstandingMinor,
  gateway,
  gatewayResponse,
  merchantId,
  orderId,
  reference,
  signal,
  supabase,
  transactionId,
}: {
  actor: string;
  expectedBankOfferTerminalStatus?: BankCardOfferTerminalStatus;
  expectedOutstandingMinor?: number | null;
  gateway: 'juicyway' | 'paystack' | 'korapay';
  gatewayResponse?: Record<string, unknown>;
  merchantId: string;
  orderId: string;
  reference: string;
  signal?: AbortSignal;
  supabase: SupabaseClient;
  transactionId: string;
}) {
  try {
    if (
      expectedBankOfferTerminalStatus &&
      (gateway !== 'paystack' || !reference.startsWith('BCO-'))
    ) {
      return {
        ok: false as const,
        outcome: {
          kind: 'completion_failed' as const,
          error: new Error('invalid_bank_offer_terminal_review_request'),
        },
      };
    }
    // Use the short-lived merchant-bound client for capture classification
    // and approval. REDVAULT RPCs also accept the service worker's role.
    const redvaultScopedClient = createStorefrontOrderRpcClient({
      fallbackClient: supabase,
      hasCanonicalDeliveryMetadata: false,
      merchantId,
      userId: null,
    });
    if (reference.startsWith('BCO-')) {
      const verified =
        gateway === 'paystack'
          ? await approveBankCardOfferPayment({
              client: redvaultScopedClient,
              expectedTerminalStatus: expectedBankOfferTerminalStatus,
              merchantId,
              orderId,
              reference,
              signal,
              transactionId,
            })
          : null;
      if (verified?.kind === 'pending' || verified?.kind === 'unavailable') {
        return {
          ok: false as const,
          outcome: {
            kind: 'bank_offer_verification_wait' as const,
            providerUnavailable: verified.kind === 'unavailable',
          },
        };
      }
      if (!verified) {
        return {
          ok: false as const,
          outcome: {
            kind: 'completion_failed' as const,
            error: new Error('bank_card_offer_verification_required'),
          },
        };
      }
      if (verified.kind === 'terminal') {
        const review = await redvaultScopedClient.rpc(
          'flag_bank_card_offer_terminal_review',
          {
            p_order_id: orderId,
            p_merchant_id: merchantId,
            p_transaction_id: transactionId,
            p_status: verified.status,
            ...(verified.reportedReversalAmountKobo !== undefined
              ? { p_reported_amount_kobo: verified.reportedReversalAmountKobo }
              : {}),
          }
        );
        if (review.error || review.data !== true) {
          return {
            ok: false as const,
            outcome: {
              kind: 'completion_failed' as const,
              error:
                review.error ??
                new Error('bank_card_offer_terminal_review_unavailable'),
            },
          };
        }
        return {
          ok: false as const,
          outcome: {
            kind: 'bank_offer_terminal' as const,
            status: verified.status,
          },
        };
      }
      if (verified.kind === 'mismatch') {
        // Open review uniqueness on issue type plus transaction/reference
        // makes repeated polling safe. A duplicate already has an ops review.
        const review = await supabase.from('reconciliation_review').insert({
          issue_type: 'payment_match_ambiguous',
          merchant_id: merchantId,
          order_id: orderId,
          txn_id: transactionId,
          paystack_ref: reference,
          reason:
            'Paystack verification does not match the saved bank card offer',
          metadata: { source: 'bank_card_offer_capture' },
        });
        if (review.error && review.error.code !== '23505') {
          return {
            ok: false as const,
            outcome: {
              kind: 'completion_failed' as const,
              error: review.error,
            },
          };
        }
        return {
          ok: false as const,
          outcome: { kind: 'bank_offer_capture_review' as const },
        };
      }
      const result = await completeOrderGatewayPayment({
        actor,
        expectedOutstandingMinor,
        gatewayResponse: verified.gatewayResponse,
        orderId,
        supabase,
        transactionId,
      });
      if (!result.ok || result.completion.error_code) {
        return {
          ok: false as const,
          outcome: {
            kind: 'completion_failed' as const,
            error: result.ok ? result.completion : result.error,
          },
        };
      }
      return {
        ...result,
        redvaultDuplicate: false,
        redvaultInventoryConfirmed: false,
        verifiedGatewayResponse: verified.gatewayResponse,
        atomicTransactionFlip: result.completion.already_completed === false,
      };
    }
    if (!gatewayResponse) {
      return {
        ok: false as const,
        outcome: {
          kind: 'completion_failed' as const,
          error: new Error('missing_gateway_response'),
        },
      };
    }
    const capture = await captureOrHoldRedvaultPayment({
      gateway,
      gatewayResponse,
      merchantId,
      orderId,
      reference,
      rpcClient: redvaultScopedClient,
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
        // Capture is already durable at this point, so an approval throw
        // (usage cap, inventory confirmation) files the same ops review
        // the non-throwing held path files before the outer catch
        // converts it to capture_hold_failed — otherwise a Paystack
        // transaction stuck pending has no durable work item.
        let approved: Awaited<
          ReturnType<typeof verifyAndCompleteRedvaultPayment>
        >;
        try {
          approved = await verifyAndCompleteRedvaultPayment({
            merchantId,
            orderId,
            reference,
            supabase: redvaultScopedClient,
            transactionId,
          });
        } catch (approvalError) {
          await fileRedvaultInventoryConfirmationReview({
            gatewayReference: reference,
            merchantId,
            metadata: {
              reason: capture.reason,
              error:
                approvalError instanceof Error
                  ? approvalError.message
                  : 'REDVAULT approval threw',
            },
            orderId,
            reason: `REDVAULT capture held approval failed: ${capture.reason}`,
            supabase: redvaultScopedClient,
            transactionId,
          });
          throw approvalError;
        }
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
            verifiedGatewayResponse: gatewayResponse,
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
    expectedOutstandingMinor,
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
    verifiedGatewayResponse: gatewayResponse,
  };
}
