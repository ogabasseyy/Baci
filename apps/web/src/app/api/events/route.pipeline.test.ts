import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MERCHANT_ID,
  mocks,
  OTHER_MERCHANT_ID,
  POST,
  request,
  resetPipelineMocks,
} from './route.pipeline.test-support';

describe('POST /api/events durable pipeline', () => {
  beforeEach(resetPipelineMocks);

  it('returns only after the atomic analytics and queue RPC succeeds', async () => {
    let resolveRecord: (value: { queue_message_id: number }) => void = () => {
      throw new Error('record promise resolver was not initialized');
    };
    mocks.record.mockReturnValue(
      new Promise((resolve) => {
        resolveRecord = resolve;
      })
    );
    mocks.resolveContext.mockResolvedValue({
      merchantId: MERCHANT_ID,
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });

    let settled = false;
    const responsePromise = POST(request()).then((response) => {
      settled = true;
      return response;
    });
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    resolveRecord({ queue_message_id: 1 });
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.event_id).toMatch(/^evt_/);
    expect(mocks.resolveContext).toHaveBeenCalledWith(
      expect.objectContaining({
        pageUrl: 'https://shop.usebaci.com/products?customer=private',
      })
    );
    expect(mocks.record).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        deliveryData: expect.objectContaining({
          fbc: 'fb.1.click',
          fbp: 'fbp.1',
          ip: '203.0.113.1',
          sccid: 'snap.1',
          ttp: 'ttp.1',
          ua: 'Baci test agent',
        }),
        eventName: 'analytics.page_view.v1',
        trustLevel: 'tenant_verified_client',
      })
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects a host and body merchant mismatch', async () => {
    mocks.resolveContext.mockResolvedValue({
      code: 'merchant_mismatch',
      ok: false,
    });

    const response = await POST(request(OTHER_MERCHANT_ID));

    expect(response.status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('uses legacy persistence and fanout when durable enqueue fails in shadow mode', async () => {
    mocks.isConversionEvent.mockReturnValue(true);
    mocks.record.mockRejectedValue(new Error('queue unavailable'));
    mocks.resolveContext.mockResolvedValue({
      merchantId: MERCHANT_ID,
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_id: MERCHANT_ID }),
      expect.any(Object)
    );
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it('does not create a request-context client for the legacy path', async () => {
    mocks.isPipelineEnabled.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it('reuses durable verified context and constructs authority inside after', async () => {
    mocks.isConversionEvent.mockReturnValue(true);
    mocks.resolveContext.mockResolvedValue({
      merchantId: MERCHANT_ID,
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]?.();
    expect(mocks.createServiceClient).toHaveBeenCalledWith('event-pipeline');
    expect(mocks.fanout).toHaveBeenCalledWith(
      expect.any(Object),
      MERCHANT_ID,
      expect.objectContaining({ merchant_id: MERCHANT_ID })
    );
  });

  it.each([
    ['page URL', { page_url: 'https://usebaci.com/victim/product' }, {}],
    ['referer', {}, { referer: 'https://usebaci.com/victim/product' }],
  ])('persists root-host %s context without elevating it', async (_name, payload, headers) => {
    mocks.isConversionEvent.mockReturnValue(true);
    mocks.resolveContext.mockImplementation(
      async ({ pageUrl, request: requestView }) =>
        pageUrl || requestView.headers.get('referer')
          ? {
              merchantId: MERCHANT_ID,
              ok: true,
              trustLevel: 'tenant_verified_client',
              verified: true,
            }
          : {
              merchantId: MERCHANT_ID,
              ok: true,
              trustLevel: 'anonymous_client',
              verified: false,
            }
    );
    const rootRequest = new NextRequest('https://usebaci.com/api/events', {
      body: JSON.stringify({
        event_type: 'purchase',
        merchant_id: MERCHANT_ID,
        ...payload,
      }),
      headers: { host: 'usebaci.com', ...headers },
      method: 'POST',
    });
    const response = await POST(rootRequest);
    expect(response.status).toBe(200);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('resolves durable-off conversion identity without changing persistence', async () => {
    mocks.isPipelineEnabled.mockReturnValue(false);
    mocks.isConversionEvent.mockReturnValue(true);
    mocks.resolveContext.mockResolvedValue({
      merchantId: MERCHANT_ID,
      ok: true,
      trustLevel: 'tenant_verified_client',
      verified: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    await mocks.afterCallbacks[0]?.();
    expect(mocks.fanout).toHaveBeenCalledWith(
      expect.any(Object),
      MERCHANT_ID,
      expect.objectContaining({ merchant_id: MERCHANT_ID })
    );
  });

  it('skips authority on durable-off mismatch while preserving the response', async () => {
    mocks.isPipelineEnabled.mockReturnValue(false);
    mocks.isConversionEvent.mockReturnValue(true);
    mocks.resolveContext.mockResolvedValue({
      code: 'merchant_mismatch',
      ok: false,
    });

    const response = await POST(request(OTHER_MERCHANT_ID));

    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalled();
    expect(mocks.afterCallbacks).toHaveLength(0);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.fanout).not.toHaveBeenCalled();
  });
});

it('persists a Necessary-only product observation with explicit no-route targets and constructs no provider authority', async () => {
  vi.clearAllMocks();
  mocks.isPipelineEnabled.mockReturnValue(true);
  mocks.isLegacyFanoutDisabled.mockReturnValue(false);
  mocks.createServerClient.mockResolvedValue({});
  mocks.isConversionEvent.mockReturnValue(true);
  mocks.record.mockResolvedValue({ queue_message_id: 1 });
  mocks.resolveContext.mockResolvedValue({
    merchantId: MERCHANT_ID,
    ok: true,
    trustLevel: 'tenant_verified_client',
    verified: true,
  });
  const response = await POST(request(MERCHANT_ID, false, 'product_view'));
  expect(response.status).toBe(200);
  expect(mocks.record).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      eventData: expect.objectContaining({ targets: [] }),
      deliveryData: expect.objectContaining({
        analytics_consent: false,
        marketing_consent: false,
      }),
    })
  );
  expect(mocks.createServiceClient).not.toHaveBeenCalled();
  expect(mocks.fanout).not.toHaveBeenCalled();
});
