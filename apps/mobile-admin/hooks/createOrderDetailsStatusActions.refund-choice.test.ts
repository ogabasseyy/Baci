import { Alert } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('createOrderDetailsStatusActions refund choice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
    });
    mocks.fetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires explicit confirmation before cancelling a paid order', async () => {
    const { actions, setSuccessModal, updateStatus } =
      createPaidOrderStatusActions();

    await actions.handleStatusUpdate('cancelled');

    expect(updateStatus).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith(
      'Cancel paid order?',
      expect.stringContaining('how the customer gets their money back'),
      expect.arrayContaining([
        expect.objectContaining({ style: 'cancel', text: 'Keep Order' }),
        expect.objectContaining({
          style: 'destructive',
          text: 'Cancel and refund to original payment method',
        }),
        expect.objectContaining({
          style: 'destructive',
          text: 'Cancel only (I will refund them)',
        }),
      ])
    );
    expect(vi.mocked(Alert.alert).mock.calls[0]?.[1]).toContain(
      'instead of cancelling again'
    );
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    expect(confirmation?.map((button) => button.text)).toEqual([
      'Keep Order',
      'Cancel and refund to original payment method',
      'Cancel only (I will refund them)',
    ]);
    confirmation
      ?.find(
        (button) =>
          button.text === 'Cancel and refund to original payment method'
      )
      ?.onPress?.();
    await vi.waitFor(() => {
      expect(setSuccessModal).toHaveBeenCalledWith(
        expect.objectContaining({
          subMessage: expect.stringContaining('Check the refund status'),
        })
      );
    });
    expect(updateStatus).toHaveBeenCalledWith({
      orderId: expect.any(String),
      refund: 'automatic',
      status: 'cancelled',
    });
  });

  it('cancels a paid order without an automatic refund when the merchant chooses to refund them', async () => {
    const { actions, setSuccessModal, updateStatus } =
      createPaidOrderStatusActions();

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    confirmation
      ?.find((button) => button.text === 'Cancel only (I will refund them)')
      ?.onPress?.();

    await vi.waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith({
        orderId: expect.any(String),
        refund: 'manual',
        status: 'cancelled',
      });
      expect(setSuccessModal).toHaveBeenCalledWith(
        expect.objectContaining({
          subMessage: expect.stringContaining('refund is pending'),
        })
      );
    });
  });
});
