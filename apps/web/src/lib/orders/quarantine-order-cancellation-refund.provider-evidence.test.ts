import { describe, expect, it } from 'vitest';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import {
  conflictingSupabase,
  order,
  transaction,
} from './quarantine-order-cancellation-refund.test-helpers';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

describe('quarantineRefund conflict evidence merge', () => {
  it('merges provider evidence into an existing review on conflict', async () => {
    const { rpc, supabase } = conflictingSupabase(true);

    await expect(
      quarantineRefund({
        metadata: {
          audit_record_failed: true,
          payment_transaction_id: 'payment-id',
          provider_refund_id: 123,
        },
        order,
        reason: 'Paystack accepted refund but its local audit record failed',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_provider_evidence_v1',
      expect.objectContaining({
        p_merchant_id: 'merchant-id',
        p_order_id: 'order-id',
        p_payment_transaction_id: 'payment-id',
        p_provider_refund_id: 123,
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_merchant_id: 'merchant-id',
        p_order_id: 'order-id',
        p_payment_transaction_id: 'payment-id',
      })
    );
  });

  it('keeps an accepted refund uncertain when merging its evidence fails', async () => {
    const { supabase } = conflictingSupabase(false);

    const error = await quarantineRefund({
      metadata: {
        payment_transaction_id: 'payment-id',
        provider_refund_id: 123,
      },
      order,
      reason: 'Paystack accepted refund but its local audit record failed',
      supabase,
      transactions: [transaction],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toMatch('merging its recovery evidence');
  });

  it('forwards ambiguous initiation into the merged leg evidence', async () => {
    const { rpc, supabase } = conflictingSupabase(true);

    await expect(
      quarantineRefund({
        metadata: {
          ambiguous_initiation: true,
          failed_payment_transaction_id: 'payment-id',
        },
        order,
        reason:
          'Paystack refund initiation failed ambiguously and may already exist for this payment leg',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_ambiguous: true,
        p_payment_transaction_id: 'payment-id',
      })
    );
  });

  it('merges leg evidence on conflict without provider evidence', async () => {
    const { rpc, supabase } = conflictingSupabase(true);

    await expect(
      quarantineRefund({
        order,
        reason: 'unsupported gateway',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_ambiguous: false,
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_provider_evidence_v1',
      expect.anything()
    );
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_accepted_refund_ids: null,
        p_merchant_id: 'merchant-id',
        p_order_id: 'order-id',
        p_payment_transaction_id: 'payment-id',
        p_reason: 'unsupported gateway',
      })
    );
  });

  it('merges failed-leg evidence with accepted refund IDs', async () => {
    const { rpc, supabase } = conflictingSupabase(true);

    await expect(
      quarantineRefund({
        metadata: {
          accepted_refund_ids: [101],
          failed_payment_transaction_id: 'payment-2',
        },
        order,
        reason: 'Paystack refund initiation failed',
        supabase,
        transactions: [{ ...transaction, id: 'payment-2' }],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_accepted_refund_ids: [101],
        p_candidates: [
          expect.objectContaining({ paymentTransactionId: 'payment-2' }),
        ],
        p_payment_transaction_id: 'payment-2',
      })
    );
  });

  it('carries the provider rejection text into the leg-evidence merge', async () => {
    const { rpc, supabase } = conflictingSupabase(true);

    await expect(
      quarantineRefund({
        metadata: {
          failed_payment_transaction_id: 'payment-id',
          provider_error: 'Insufficient balance',
          provider_error_code: 'insufficient_balance',
        },
        order,
        reason: 'Paystack refund initiation was rejected for this payment leg',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_provider_error: 'Insufficient balance',
        p_provider_error_code: 'insufficient_balance',
      })
    );
  });

  it('sends null provider evidence when the quarantine has none', async () => {
    const { rpc, supabase } = conflictingSupabase(true);

    await quarantineRefund({
      order,
      reason: 'unsupported gateway',
      supabase,
      transactions: [transaction],
    }).catch(() => undefined);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_provider_error: null,
        p_provider_error_code: null,
      })
    );
  });

  it('keeps the step uncertain when merging leg evidence fails', async () => {
    const { supabase } = conflictingSupabase(false);

    const error = await quarantineRefund({
      metadata: { failed_payment_transaction_id: 'payment-id' },
      order,
      reason: 'Paystack refund initiation failed',
      supabase,
      transactions: [transaction],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toMatch('merging its recovery evidence');
  });
});
