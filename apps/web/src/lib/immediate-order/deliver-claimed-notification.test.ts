import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverClaimedImmediateOrderNotification } from './deliver-claimed-notification';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const artifactMocks = vi.hoisted(() => ({ build: vi.fn() }));

vi.mock('./invoice-artifacts', () => ({
  buildImmediateInvoiceArtifacts: artifactMocks.build,
}));

const payformeMocks = vi.hoisted(() => ({ provisionRetry: vi.fn() }));

vi.mock('./payforme-dva', () => ({
  provisionPayformeRetryDva: payformeMocks.provisionRetry,
}));

const emailMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('./confirmation-email', () => ({
  sendImmediateOrderConfirmationEmail: emailMocks.send,
}));

const retryMocks = vi.hoisted(() => ({ complete: vi.fn() }));

vi.mock('./notification-completion-retry', () => ({
  completeNotificationWithProvisioningRetry: retryMocks.complete,
}));

const markerMocks = vi.hoisted(() => ({ mark: vi.fn() }));

vi.mock('./notification-start-marker', () => ({
  markImmediateOrderNotificationStartedWithProof: markerMocks.mark,
}));

type DeliveryInput = Parameters<
  typeof deliverClaimedImmediateOrderNotification
>[0];

function baseInput(): DeliveryInput {
  return {
    notificationCtx: {
      supabase: { rpc: vi.fn() },
      trackingToken: 'track-1',
    },
    orderId: 'order-1',
    effectivePaymentMethod: 'invoice',
    claimToken: 'lease-1',
    preResponsePayforme: { virtualAccount: null },
  } as unknown as DeliveryInput;
}

describe('deliverClaimedImmediateOrderNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    artifactMocks.build.mockResolvedValue({
      attachments: [],
      invoiceVirtualAccount: null,
    });
    payformeMocks.provisionRetry.mockResolvedValue(null);
    emailMocks.send.mockResolvedValue(undefined);
    retryMocks.complete.mockResolvedValue({ completed: true });
    markerMocks.mark.mockResolvedValue(undefined);
  });

  it('marks, builds invoice artifacts, sends, and completes sent', async () => {
    await deliverClaimedImmediateOrderNotification(baseInput());

    expect(markerMocks.mark).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      'lease-1'
    );
    expect(artifactMocks.build).toHaveBeenCalled();
    expect(payformeMocks.provisionRetry).not.toHaveBeenCalled();
    expect(emailMocks.send).toHaveBeenCalled();
    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      true,
      'lease-1'
    );
  });

  it('provisions the payforme retry DVA instead of invoice artifacts', async () => {
    await deliverClaimedImmediateOrderNotification({
      ...baseInput(),
      effectivePaymentMethod: 'payforme',
    });

    expect(artifactMocks.build).not.toHaveBeenCalled();
    expect(payformeMocks.provisionRetry).toHaveBeenCalled();
    expect(emailMocks.send).toHaveBeenCalled();
    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      true,
      'lease-1'
    );
  });

  it('completes failed and logs when the send throws', async () => {
    emailMocks.send.mockRejectedValueOnce(new Error('smtp down'));

    await deliverClaimedImmediateOrderNotification(baseInput());

    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      false,
      'lease-1'
    );
  });

  it('completes failed when artifacts reject without sending', async () => {
    artifactMocks.build.mockRejectedValueOnce(new Error('items down'));

    await deliverClaimedImmediateOrderNotification(baseInput());

    expect(emailMocks.send).not.toHaveBeenCalled();
    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      false,
      'lease-1'
    );
  });
});
