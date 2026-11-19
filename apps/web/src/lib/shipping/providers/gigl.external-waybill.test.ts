import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseUrl, jsonResponse } from './gigl.test-helpers';

const ACCOUNT_USER_ID = 'e9de76d8-208a-44b6-bf02-9842fb8a9bee';

const loginEnvelope = (token: string) => ({
  success: true,
  data: {
    message: 'Success',
    status: 200,
    data: {
      'access-token': token,
      Id: ACCOUNT_USER_ID,
      UserChannelCode: 'IND405919',
      UserChannelType: 2,
    },
  },
});

const preShipmentEnvelope = {
  message: 'Success',
  status: 200,
  data: [
    {
      Waybill: '1349639588',
      UserId: ACCOUNT_USER_ID,
      CustomerCode: 'IND405919',
      ReceiverName: 'Audu Emmanuel',
      ReceiverPhoneNumber: '+2348037608805',
      ReceiverAddress: 'ABAKALIKI => ABAKALIKI (CENTRAL PARK)',
      ReceiverState: 'EBONYI',
      IsHomeDelivery: false,
      IsCancelled: false,
      GrandTotal: 45852.2,
    },
  ],
};

const trackingEnvelope = {
  message: 'Success',
  status: 200,
  data: [
    {
      Waybill: '1349639588',
      MobileShipmentTrackings: [
        {
          MobileShipmentTrackingId: 8749283,
          ShipmentTrackingId: 126337734,
          Status: 'ACC',
          ScanStatusReason: 'Shipment Arrives Collation Center',
          DateTimeUtc: '2026-10-31T19:55:27.840Z',
          Location: 'LAGOS GATEWAY',
        },
      ],
    },
  ],
};

function statusResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const notFound = () =>
  statusResponse(401, {
    message: 'Shipment Details Not Found.',
    status: 401,
    data: {},
  });

describe('GIGL external waybill lookup', () => {
  beforeEach(() => {
    process.env.GIGL_BASE_URL = baseUrl;
    process.env.GIGL_EMAIL = 'test@example.com';
    process.env.GIGL_PASSWORD = 'test-password';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.GIGL_BASE_URL;
    delete process.env.GIGL_EMAIL;
    delete process.env.GIGL_PASSWORD;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads the pre-shipment and tracking snapshot with the account identity', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('token-1')))
      .mockResolvedValueOnce(jsonResponse(preShipmentEnvelope))
      .mockResolvedValueOnce(jsonResponse(trackingEnvelope));
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    const result = await new GiglProvider().lookupExternalWaybill('1349639588');

    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.account).toEqual({
      userChannelCode: 'IND405919',
      userId: ACCOUNT_USER_ID,
    });
    expect(result.preShipment.ReceiverState).toBe('EBONYI');
    expect(result.tracking?.status).toBe('in_transit');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${baseUrl}/get/preshipment?Waybill=1349639588`
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `${baseUrl}/track/mobileShipment?Waybill=1349639588&fetchOption=1`
    );
    const headers = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(headers.get('access-token')).toBe('token-1');
  });

  it('reports an unknown waybill without logging in again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('token-1')))
      .mockResolvedValueOnce(notFound());
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    await expect(
      new GiglProvider().lookupExternalWaybill('1000000001')
    ).resolves.toEqual({ status: 'not_found' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the token once when GIG rejects it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('stale')))
      .mockResolvedValueOnce(
        statusResponse(401, { message: 'Unauthorized', status: 401 })
      )
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('fresh')))
      .mockResolvedValueOnce(jsonResponse(preShipmentEnvelope))
      .mockResolvedValueOnce(notFound());
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    const result = await new GiglProvider().lookupExternalWaybill('1349639588');

    expect(result).toMatchObject({ status: 'found', tracking: null });
    const retryHeaders = new Headers(fetchMock.mock.calls[3]?.[1]?.headers);
    expect(retryHeaders.get('access-token')).toBe('fresh');
  });

  it('still finds the waybill when the tracking endpoint fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('token-1')))
      .mockResolvedValueOnce(jsonResponse(preShipmentEnvelope))
      .mockResolvedValueOnce(statusResponse(502, { message: 'Bad gateway' }));
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    await expect(
      new GiglProvider().lookupExternalWaybill('1349639588')
    ).resolves.toMatchObject({ status: 'found', tracking: null });
  });

  it('accepts a single pre-shipment record instead of a list', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('token-1')))
      .mockResolvedValueOnce(
        jsonResponse({
          ...preShipmentEnvelope,
          data: preShipmentEnvelope.data[0],
        })
      )
      .mockResolvedValueOnce(notFound());
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    await expect(
      new GiglProvider().lookupExternalWaybill('1349639588')
    ).resolves.toMatchObject({
      status: 'found',
      preShipment: { Waybill: '1349639588', CustomerCode: 'IND405919' },
    });
  });

  it('treats a response for a different waybill as not found', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('token-1')))
      .mockResolvedValueOnce(
        jsonResponse({
          ...preShipmentEnvelope,
          data: [{ ...preShipmentEnvelope.data[0], Waybill: '999' }],
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    await expect(
      new GiglProvider().lookupExternalWaybill('1349639588')
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('fails on GIG server errors instead of reporting not found', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loginEnvelope('token-1')))
      .mockResolvedValueOnce(statusResponse(502, { message: 'Bad gateway' }));
    vi.stubGlobal('fetch', fetchMock);

    const { GiglProvider } = await import('./gigl');
    await expect(
      new GiglProvider().lookupExternalWaybill('1349639588')
    ).rejects.toThrow('GIGL waybill lookup failed (502)');
  });
});
