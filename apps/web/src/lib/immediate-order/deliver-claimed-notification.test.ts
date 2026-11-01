import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverClaimedImmediateOrderNotification } from './deliver-claimed-notification';
import { ImmediateNotificationDeliveryUnknownError } from './notification-delivery-unknown-error';
import { recoverImmediateNotifications } from './notification-redrive-worker';

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
const dispatchMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  reset: vi.fn(),
  accepted: vi.fn(),
}));
vi.mock('./notification-redrive-dispatch', () => ({
  createImmediateNotificationDispatch: () => ({
    beforeTransportDispatch: dispatchMocks.begin,
    resetTransportDispatch: dispatchMocks.reset,
    recordAcceptance: dispatchMocks.accepted,
  }),
}));

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
    vi.resetAllMocks();
    vi.stubEnv('IMMEDIATE_NOTIFICATION_REDRIVE_ENABLED', 'true');
    artifactMocks.build.mockResolvedValue({
      attachments: [],
      invoiceVirtualAccount: null,
    });
    payformeMocks.provisionRetry.mockResolvedValue(null);
    dispatchMocks.begin.mockResolvedValue(undefined);
    dispatchMocks.reset.mockResolvedValue(undefined);
    dispatchMocks.accepted.mockResolvedValue(undefined);
    emailMocks.send.mockImplementation(async (_ctx, _artifacts, hooks) => {
      await hooks.beforeTransportDispatch();
    });
    retryMocks.complete.mockResolvedValue({ completed: true });
    markerMocks.mark.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('preserves delivery without worker credentials before the redrive cutover', async () => {
    vi.stubEnv('IMMEDIATE_NOTIFICATION_REDRIVE_ENABLED', 'false');
    emailMocks.send.mockResolvedValueOnce(undefined);
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(emailMocks.send).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined
    );
    expect(dispatchMocks.begin).not.toHaveBeenCalled();
    expect(dispatchMocks.accepted).not.toHaveBeenCalled();
    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      true,
      'lease-1'
    );
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
    expect(dispatchMocks.begin).toHaveBeenCalledOnce();
    expect(dispatchMocks.accepted).toHaveBeenCalledOnce();
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

  it('does not release or mark failed when the provider outcome is unknown', async () => {
    emailMocks.send.mockImplementationOnce(async (_ctx, _artifacts, hooks) => {
      await hooks.beforeTransportDispatch();
      throw new ImmediateNotificationDeliveryUnknownError();
    });
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(dispatchMocks.reset).not.toHaveBeenCalled();
    expect(retryMocks.complete).not.toHaveBeenCalled();
  });

  it('releases its own unacknowledged begin before making the claim retryable', async () => {
    dispatchMocks.begin.mockRejectedValueOnce(new Error('begin response lost'));
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(dispatchMocks.reset).toHaveBeenCalledOnce();
    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      false,
      'lease-1'
    );
  });

  it('keeps an unacknowledged begin fenced when its release is unconfirmed', async () => {
    dispatchMocks.begin.mockRejectedValueOnce(new Error('begin response lost'));
    dispatchMocks.reset.mockRejectedValueOnce(
      new Error('release not confirmed')
    );
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(dispatchMocks.reset).toHaveBeenCalledOnce();
    expect(retryMocks.complete).not.toHaveBeenCalled();
  });

  it('does not mark an accepted email failed when acceptance persistence is uncertain', async () => {
    dispatchMocks.accepted.mockRejectedValueOnce(new Error('fixture'));
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(dispatchMocks.reset).not.toHaveBeenCalled();
    expect(retryMocks.complete).not.toHaveBeenCalled();
  });

  it('recovers a sent email after completion exhausts without sending it again', async () => {
    const orderId = 'd0000000-0000-4000-8000-000000000001';
    const lease = 'd0000000-0000-4000-8000-000000000002';
    retryMocks.complete.mockResolvedValueOnce({ completed: false });
    await deliverClaimedImmediateOrderNotification({
      ...baseInput(),
      orderId,
      claimToken: lease,
    });
    expect(dispatchMocks.accepted).toHaveBeenCalledOnce();
    expect(emailMocks.send).toHaveBeenCalledOnce();
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ order_id: orderId, claim_token: lease, status: 'accepted' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    await expect(recoverImmediateNotifications({ rpc }, 1)).resolves.toEqual({
      recovered: 1,
      unresolved: 0,
      hasReconciliationBacklog: false,
    });
    expect(emailMocks.send).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      'recover_immediate_notification_completion',
      {
        p_order_id: orderId,
        p_claim_token: lease,
      }
    );
  });

  it('releases a fenced dispatch only after a definite rejection', async () => {
    emailMocks.send.mockImplementationOnce(async (_ctx, _artifacts, hooks) => {
      await hooks.beforeTransportDispatch();
      throw new Error('definite provider rejection');
    });
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(dispatchMocks.reset).toHaveBeenCalledOnce();
    expect(retryMocks.complete).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'track-1',
      false,
      'lease-1'
    );
  });

  it('does not complete failed when release of the dispatch fence is unconfirmed', async () => {
    emailMocks.send.mockImplementationOnce(async (_ctx, _artifacts, hooks) => {
      await hooks.beforeTransportDispatch();
      throw new Error('definite provider rejection');
    });
    dispatchMocks.reset.mockRejectedValueOnce(new Error('fixture'));
    await deliverClaimedImmediateOrderNotification(baseInput());
    expect(retryMocks.complete).not.toHaveBeenCalled();
  });
});
