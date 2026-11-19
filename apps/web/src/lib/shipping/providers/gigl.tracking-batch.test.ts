import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/gigl-batch-tracking-success.contract.json';
import {
  GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT,
  GIGL_TRACKING_RESPONSE_MAX_BYTES,
  GIGL_TRACKING_WAYBILL_MAX_LENGTH,
} from './gigl.constants';
import { trackGiglShipmentBatch } from './gigl.tracking-batch';
import { setupApi, shipment, token } from './gigl.tracking-batch.test-fixtures';

describe('trackGiglShipmentBatch', () => {
  beforeEach(() => {
    vi.stubEnv('GIGL_BASE_URL', 'https://gigl.test');
    vi.stubEnv('GIGL_TRACKING_BATCH_TIMEOUT_MS', '');
    vi.resetModules();
  });

  it('normalizes the verified successful contract fixture', async () => {
    const { apiClient, io, safeFetch } = setupApi(fixture);

    const results = await trackGiglShipmentBatch(apiClient, io, [
      ' SYNTHETIC-WB-1 ',
      'SYNTHETIC-WB-2',
    ]);

    expect(results.get('SYNTHETIC-WB-1')?.status).toBe('pickup_scheduled');
    expect(results.get('SYNTHETIC-WB-2')?.status).toBe('delivered');
    expect(safeFetch).toHaveBeenCalledWith(
      `${apiClient.baseUrl}/track/multipleMobileShipment`,
      expect.objectContaining({ method: 'POST' })
    );
    const request = safeFetch.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      Waybill: ['SYNTHETIC-WB-1', 'SYNTHETIC-WB-2'],
    });
    expect(String(request?.body)).not.toContain('fetchOption');
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(request?.timeout).toBe(15_000);
  });

  it('accepts a valid 2xx envelope when success is omitted', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      data: [shipment('WB-OPTIONAL-SUCCESS')],
    });

    const results = await trackGiglShipmentBatch(apiClient, io, [
      'WB-OPTIONAL-SUCCESS',
    ]);

    expect(results.get('WB-OPTIONAL-SUCCESS')?.status).toBe('delivered');
  });

  it.each([
    [[], 'At least one GIGL waybill is required'],
    [
      Array.from({ length: 51 }, (_, index) => `WB-${index}`),
      'GIGL tracking batch exceeds 50 waybills',
    ],
    [['WB-1', ' WB-1 '], 'duplicate waybill'],
  ] as const)('rejects invalid requested waybills before the provider call', async (waybills, message) => {
    const { apiClient, io, safeFetch } = setupApi(fixture);

    await expect(
      trackGiglShipmentBatch(apiClient, io, waybills)
    ).rejects.toThrow(message);
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 200, success: false, data: [shipment('WB-1')] }],
  ])('rejects batch responses that drift from the observed successful contract', async (envelope) => {
    const { apiClient, io } = setupApi(envelope);

    await expect(
      trackGiglShipmentBatch(apiClient, io, ['WB-1'])
    ).rejects.toThrow('Invalid GIGL batch tracking response');
  });

  it('keeps valid shipments when another returned shipment fails schema validation', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      success: true,
      data: [{ ...shipment('WB-BAD'), Amount: undefined }, shipment('WB-GOOD')],
    });

    const results = await trackGiglShipmentBatch(apiClient, io, [
      'WB-BAD',
      'WB-GOOD',
    ]);

    expect([...results.keys()]).toEqual(['WB-GOOD']);
    expect(io.log).toHaveBeenCalledWith(
      'warn',
      'GIGL batch tracking omitted schema-invalid shipment',
      { count: 1 }
    );
  });

  it('rejects malformed data and duplicate returned waybills', async () => {
    for (const data of [
      null,
      {},
      [shipment('WB-1'), shipment(' WB-1 ')],
    ] as const) {
      const { apiClient, io } = setupApi({ status: 200, success: true, data });
      await expect(
        trackGiglShipmentBatch(apiClient, io, ['WB-1'])
      ).rejects.toThrow();
    }
  });

  it('keeps valid shipments when another returned shipment has no valid events', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      success: true,
      data: [
        {
          ...shipment('WB-BAD'),
          MobileShipmentTrackings: [
            {
              Status: 'UNPUBLISHED_CODE',
              DateTimeUtc: 'not-a-date',
            },
          ],
        },
        shipment('WB-GOOD'),
      ],
    });

    const results = await trackGiglShipmentBatch(apiClient, io, [
      'WB-BAD',
      'WB-GOOD',
    ]);

    expect([...results.keys()]).toEqual(['WB-GOOD']);
    expect(io.log).toHaveBeenCalledWith(
      'warn',
      'GIGL batch tracking omitted malformed shipment',
      expect.objectContaining({ waybill: 'WB-BAD' })
    );
  });

  it('omits requested waybills absent from a valid response', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      success: true,
      data: [shipment('WB-1')],
    });

    const results = await trackGiglShipmentBatch(apiClient, io, [
      'WB-1',
      'WB-2',
    ]);

    expect([...results.keys()]).toEqual(['WB-1']);
  });

  it('rejects waybills longer than the tracking boundary before calling GIGL', async () => {
    const { apiClient, io, safeFetch } = setupApi(fixture);
    const oversizedWaybill = 'W'.repeat(GIGL_TRACKING_WAYBILL_MAX_LENGTH + 1);

    await expect(
      trackGiglShipmentBatch(apiClient, io, [oversizedWaybill])
    ).rejects.toThrow('GIGL tracking waybill exceeds maximum length');
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it.each([
    [shipment('UNREQUESTED-WB')],
    [shipment('W'.repeat(GIGL_TRACKING_WAYBILL_MAX_LENGTH + 1))],
  ])('rejects returned waybills that cannot be matched to the request', async (data) => {
    const { apiClient, io } = setupApi({
      status: 200,
      success: true,
      data,
    });

    await expect(
      trackGiglShipmentBatch(apiClient, io, ['WB-1'])
    ).rejects.toThrow();
  });

  it('accepts the per-shipment and total event limits', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      success: true,
      data: Array.from({ length: 10 }, (_, index) =>
        shipment(`WB-${index}`, GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT)
      ),
    });

    const results = await trackGiglShipmentBatch(
      apiClient,
      io,
      Array.from({ length: 10 }, (_, index) => `WB-${index}`)
    );

    expect(results.size).toBe(10);
  });

  it('rejects a valid batch that exceeds the total event limit', async () => {
    const data = [
      ...Array.from({ length: 10 }, (_, index) =>
        shipment(`WB-${index}`, GIGL_TRACKING_MAX_EVENTS_PER_SHIPMENT)
      ),
      shipment('WB-10', 1),
    ];
    const { apiClient, io } = setupApi({ status: 200, success: true, data });

    await expect(
      trackGiglShipmentBatch(
        apiClient,
        io,
        data.map((item) => item.Waybill ?? '')
      )
    ).rejects.toThrow();
  });

  it('passes the existing response byte cap to the batch request', async () => {
    const { apiClient, io } = setupApi(fixture);
    const safeFetchEnvelopeSpy = vi.spyOn(
      apiClient,
      'safeFetchEnvelopeWithAccessToken'
    );

    await trackGiglShipmentBatch(apiClient, io, [
      'SYNTHETIC-WB-1',
      'SYNTHETIC-WB-2',
    ]);

    expect(safeFetchEnvelopeSpy).toHaveBeenCalledWith(
      expect.any(String),
      token,
      expect.any(Function),
      { maxResponseBytes: GIGL_TRACKING_RESPONSE_MAX_BYTES }
    );
  });
});
