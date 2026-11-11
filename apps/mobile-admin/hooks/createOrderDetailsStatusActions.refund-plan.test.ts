import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaidOrderStatusActions } from './createOrderDetailsStatusActions.test-support';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

vi.mock('@/lib/api-client', () => ({
  BASE_URL: 'https://example.com',
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

describe('cancellation refund plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a refund-review action instead of an automatic refund when a leg is unsupported', async () => {
    const { actions, updateStatus } = createPaidOrderStatusActions({
      order: {
        cancel_refund_plan: {
          amount: 5000,
          automaticSupported: false,
          inFlightAmount: 0,
          ledgerKnown: true,
        },
      },
    });
    await actions.handleStatusUpdate('cancelled');
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    expect(buttons?.map((button) => button.text)).toEqual([
      'Keep Order',
      'Cancel and send the refund to review',
      'Cancel only (I will refund them)',
    ]);
    buttons?.[1]?.onPress?.();
    await vi.waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ refund: 'automatic' })
      );
    });
  });

  it('uses the plain confirmation when nothing external is refundable', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: {
        cancel_refund_plan: {
          amount: 0,
          automaticSupported: true,
          inFlightAmount: 0,
          ledgerKnown: true,
        },
      },
    });
    await actions.handleStatusUpdate('cancelled');
    expect(vi.mocked(Alert.alert).mock.calls[0]?.[0]).toBe('Cancel order?');
  });

  it('words the success message from the server refund outcome', async () => {
    const { actions, setSuccessModal } = createPaidOrderStatusActions({
      updateStatus: vi
        .fn()
        .mockResolvedValue({ refund_outcome: 'queued_if_required' }),
    });
    await actions.handleStatusUpdate('cancelled');
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    buttons
      ?.find((button) => button.text === 'Cancel only (I will refund them)')
      ?.onPress?.();
    await vi.waitFor(() => {
      expect(setSuccessModal).toHaveBeenCalledWith(
        expect.objectContaining({
          subMessage: expect.stringContaining('Check the refund status'),
        })
      );
    });
  });

  it('tells the merchant to wait when the provider refund is already in flight', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: {
        cancel_refund_plan: {
          amount: 0,
          automaticSupported: true,
          inFlightAmount: 5000,
          ledgerKnown: true,
        },
      },
    });
    await actions.handleStatusUpdate('cancelled');
    const call = vi.mocked(Alert.alert).mock.calls[0];
    expect(call?.[0]).toBe('Cancel order?');
    expect(call?.[1]).toContain('already in progress with the provider');
    expect(call?.[2]?.map((button) => button.text)).not.toContain(
      'Cancel only (I will refund them)'
    );
  });

  it('limits the cancel-only refund to the amount not already in flight', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: {
        // Blank currency codes fall back to NGN for both amounts.
        currency: '   ',
        cancel_refund_plan: {
          amount: 3000,
          automaticSupported: true,
          inFlightAmount: 2000,
          ledgerKnown: true,
        },
      },
    });
    await actions.handleStatusUpdate('cancelled');
    const call = vi.mocked(Alert.alert).mock.calls[0];
    expect(call?.[1]).toMatch(/refunding NGN\s2,000\.00 of this payment/);
    expect(call?.[1]).toMatch(
      /only the remaining NGN\s3,000\.00 is yours to refund/
    );
    expect(call?.[2]?.map((button) => button.text)).toContain(
      'Cancel only (I will refund them)'
    );
  });

  it('cancels neutrally, without a manual option, when the refund plan is unavailable', async () => {
    const { actions, updateStatus } = createPaidOrderStatusActions({
      order: { cancel_refund_plan: undefined },
    });
    await actions.handleStatusUpdate('cancelled');
    const call = vi.mocked(Alert.alert).mock.calls[0];
    expect(call?.[0]).toBe('Cancel order?');
    expect(call?.[1]).toContain("couldn't be loaded");
    const buttons = call?.[2];
    expect(buttons?.map((button) => button.text)).toEqual([
      'Keep Order',
      'Cancel Order',
    ]);
    buttons?.[1]?.onPress?.();
    await vi.waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith({
        orderId: 'order-paid',
        status: 'cancelled',
      });
    });
  });

  it('recognizes a case-variant paid status when choosing the prompt', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: { amount_paid: 0, payment_status: 'PAID' as never },
    });
    await actions.handleStatusUpdate('cancelled');
    expect(vi.mocked(Alert.alert).mock.calls[0]?.[0]).toBe(
      'Cancel paid order?'
    );
  });

  it('shows neutral copy when the server reports an unknown refund outcome', async () => {
    const { actions, setSuccessModal } = createPaidOrderStatusActions({
      updateStatus: vi.fn().mockResolvedValue({ refund_outcome: 'unknown' }),
    });
    await actions.handleStatusUpdate('cancelled');
    vi.mocked(Alert.alert)
      .mock.calls[0]?.[2]?.find(
        (button) => button.text === 'Cancel only (I will refund them)'
      )
      ?.onPress?.();
    await vi.waitFor(() => {
      expect(setSuccessModal).toHaveBeenCalledWith(
        expect.objectContaining({
          subMessage: expect.stringContaining(
            'do not refund the customer by hand'
          ),
        })
      );
    });
  });

  it('offers the refund choice when the plan has money outstanding but the cached status is not paid', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: { amount_paid: 0, payment_status: 'pending' },
    });
    await actions.handleStatusUpdate('cancelled');
    expect(vi.mocked(Alert.alert).mock.calls[0]?.[0]).toBe(
      'Cancel paid order?'
    );
  });

  it('states the in-flight and remaining amounts after a cancel-only cancellation', async () => {
    const { actions, setSuccessModal } = createPaidOrderStatusActions({
      updateStatus: vi.fn().mockResolvedValue({
        refund_details: {
          currency: 'NGN',
          inFlightAmount: 2000,
          remainingAmount: 3000,
        },
        refund_outcome: 'manual_required',
      }),
    });
    await actions.handleStatusUpdate('cancelled');
    vi.mocked(Alert.alert)
      .mock.calls[0]?.[2]?.find(
        (button) => button.text === 'Cancel only (I will refund them)'
      )
      ?.onPress?.();
    await vi.waitFor(() => {
      expect(setSuccessModal).toHaveBeenCalledWith(
        expect.objectContaining({
          subMessage: expect.stringMatching(
            /2,000\.00 is already being refunded by the provider; you only need to refund .*3,000\.00/
          ),
        })
      );
    });
  });

  it('cancels neutrally when the plan could not attribute a refund to a leg', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: {
        cancel_refund_plan: {
          amount: 200,
          automaticSupported: true,
          inFlightAmount: 0,
          ledgerKnown: false,
        },
      },
    });
    await actions.handleStatusUpdate('cancelled');
    const call = vi.mocked(Alert.alert).mock.calls[0];
    expect(call?.[1]).toContain("couldn't be loaded");
    expect(call?.[2]?.map((button) => button.text)).not.toContain(
      'Cancel only (I will refund them)'
    );
  });

  it('rechecks open refund evidence at confirm time and falls back to the neutral cancel', async () => {
    const refundEvidenceBlocksChoice = vi.fn().mockResolvedValue(true);
    const { actions } = createPaidOrderStatusActions({
      refundEvidenceBlocksChoice,
    });
    await actions.handleStatusUpdate('cancelled');
    expect(refundEvidenceBlocksChoice).toHaveBeenCalledWith('order-paid');
    const call = vi.mocked(Alert.alert).mock.calls[0];
    expect(call?.[0]).toBe('Cancel order?');
    expect(call?.[2]?.map((button) => button.text)).not.toContain(
      'Cancel only (I will refund them)'
    );
  });

  it('keeps the refund choice when the confirm-time recheck finds no open evidence', async () => {
    const { actions } = createPaidOrderStatusActions({
      refundEvidenceBlocksChoice: vi.fn().mockResolvedValue(false),
    });
    await actions.handleStatusUpdate('cancelled');
    expect(vi.mocked(Alert.alert).mock.calls[0]?.[0]).toBe(
      'Cancel paid order?'
    );
  });
});
