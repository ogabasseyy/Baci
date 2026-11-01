import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, createClient } = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('./notification-redrive-client', () => ({
  createImmediateNotificationRedriveClient: createClient,
}));

import { createImmediateNotificationDispatch } from './notification-redrive-dispatch';

describe('durable immediate notification dispatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    createClient.mockReturnValue({ rpc });
  });

  it('requires an acknowledged lease-bound dispatch before transport', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const dispatch = createImmediateNotificationDispatch({
      orderId: 'order',
      claimToken: 'lease',
      env: {},
    });
    await dispatch.beforeTransportDispatch();
    expect(rpc).toHaveBeenCalledWith('begin_immediate_notification_dispatch', {
      p_order_id: 'order',
      p_claim_token: 'lease',
      p_dispatch_token: expect.any(String),
    });
  });

  it('uses the same attempt identity to reconcile a lost begin response', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'connection_lost' },
    });
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const dispatch = createImmediateNotificationDispatch({
      orderId: 'order',
      claimToken: 'lease',
      env: {},
    });
    await expect(dispatch.beforeTransportDispatch()).rejects.toThrow();
    await dispatch.resetTransportDispatch();
    expect(rpc.mock.calls[0][1].p_dispatch_token).toEqual(expect.any(String));
    expect(rpc.mock.calls[1][1].p_dispatch_token).toBe(
      rpc.mock.calls[0][1].p_dispatch_token
    );
  });

  it('uses a fresh attempt identity for a later transport attempt', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const dispatch = createImmediateNotificationDispatch({
      orderId: 'order',
      claimToken: 'lease',
      env: {},
    });
    await dispatch.beforeTransportDispatch();
    await dispatch.resetTransportDispatch();
    await dispatch.beforeTransportDispatch();
    expect(rpc.mock.calls[2][1].p_dispatch_token).not.toBe(
      rpc.mock.calls[0][1].p_dispatch_token
    );
  });

  it.each([
    { data: false, error: null },
    { data: null, error: { code: 'fixture' } },
  ])('fails closed if the durable dispatch was not confirmed', async (result) => {
    rpc.mockResolvedValue(result);
    const dispatch = createImmediateNotificationDispatch({
      orderId: 'order',
      claimToken: 'lease',
      env: {},
    });
    await expect(dispatch.beforeTransportDispatch()).rejects.toThrow();
  });

  it('records accepted delivery against the same order and lease', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const dispatch = createImmediateNotificationDispatch({
      orderId: 'order',
      claimToken: 'lease',
      env: {},
    });
    await dispatch.beforeTransportDispatch();
    await dispatch.recordAcceptance();
    expect(rpc).toHaveBeenCalledWith(
      'record_immediate_notification_acceptance',
      {
        p_order_id: 'order',
        p_claim_token: 'lease',
        p_dispatch_token: expect.any(String),
      }
    );
  });

  it('never turns an unconfirmed acceptance write into permission to resend', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'secret fixture' },
    });
    const dispatch = createImmediateNotificationDispatch({
      orderId: 'order',
      claimToken: 'lease',
      env: {},
    });
    await dispatch.beforeTransportDispatch();
    await expect(dispatch.recordAcceptance()).rejects.toThrow(
      'transition was not confirmed'
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).not.toHaveBeenCalledWith(
      'release_immediate_notification_dispatch',
      expect.anything()
    );
  });
});
