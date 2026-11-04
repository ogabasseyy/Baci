import { describe, expect, it, vi } from 'vitest';
import { GiglApiClient } from './gigl.auth';
import type { GiglProviderIo, GiglToken } from './gigl.constants';
import { attestGiglWaybillOwnership } from './gigl.preshipment-ownership';

const BACI_ACCOUNT = 'ECO-BACI-001';

const token: GiglToken = {
  token: 'token',
  userChannelCode: BACI_ACCOUNT,
  customerType: 1,
  expiresAt: Date.now() + 60_000,
};

function record(waybill: string, customerCode: string | null) {
  return {
    Waybill: waybill,
    CustomerCode: customerCode,
    SenderName: 'Private Sender',
    ReceiverPhoneNumber: '+2348000000000',
  };
}

function setupApi(body: unknown, init: ResponseInit = { status: 200 }) {
  const safeFetch = vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  );
  const log = vi.fn();
  const io: GiglProviderIo = { safeFetch, log };
  const apiClient = new GiglApiClient(io);
  vi.spyOn(apiClient, 'getApiToken').mockResolvedValue(token);
  return { apiClient, io, log, safeFetch };
}

function expectNoPrivateDataLogged(log: ReturnType<typeof vi.fn>) {
  const logged = JSON.stringify(log.mock.calls);
  for (const secret of [
    'WB-PRIVATE-1',
    BACI_ACCOUNT,
    'ECO-MERCHANT-9',
    'Private Sender',
  ]) {
    expect(logged).not.toContain(secret);
  }
}

describe('attestGiglWaybillOwnership', () => {
  it("attests a waybill whose preshipment record names Baci's GIG account", async () => {
    const { apiClient, io, safeFetch } = setupApi({
      status: 200,
      data: record('WB-PRIVATE-1', BACI_ACCOUNT),
    });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, ' WB-PRIVATE-1 ')
    ).resolves.toBe('owned');

    const [url, options] = safeFetch.mock.calls[0] ?? [];
    expect(url).toBe(
      `${apiClient.baseUrl}/get/preshipment?Waybill=WB-PRIVATE-1`
    );
    expect(options?.method).toBe('GET');
    expect(new Headers(options?.headers).get('access-token')).toBe('token');
  });

  it('accepts an array response when every record for the waybill is Baci-owned', async () => {
    const { apiClient, io } = setupApi({
      status: 200,
      data: [
        record('WB-OTHER', 'ECO-MERCHANT-9'),
        record('WB-PRIVATE-1', BACI_ACCOUNT),
      ],
    });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('owned');
  });

  it("bugfix: refuses a decoy waybill from a merchant's own GIG account", async () => {
    const { apiClient, io, log } = setupApi({
      status: 200,
      data: record('WB-PRIVATE-1', 'ECO-MERCHANT-9'),
    });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('not_owned');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'GIGL preshipment ownership not attested',
      { code: 'gigl_preshipment_not_account_owned' }
    );
    expectNoPrivateDataLogged(log);
  });

  it.each([
    ['a missing owner', record('WB-PRIVATE-1', null)],
    ['a blank owner', record('WB-PRIVATE-1', '  ')],
    [
      'bugfix: a Baci-owned record plus a same-waybill record with a numeric owner',
      [
        record('WB-PRIVATE-1', BACI_ACCOUNT),
        { Waybill: 'WB-PRIVATE-1', CustomerCode: 12345 },
      ],
    ],
    [
      'a second record owned by another account',
      [
        record('WB-PRIVATE-1', BACI_ACCOUNT),
        record('WB-PRIVATE-1', 'ECO-MERCHANT-9'),
      ],
    ],
  ])('refuses %s', async (_label, data) => {
    const { apiClient, io, log } = setupApi({ status: 200, data });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('not_owned');
    expectNoPrivateDataLogged(log);
  });

  it.each([
    ['no record for the waybill', [record('WB-OTHER', BACI_ACCOUNT)]],
    ['an empty list', []],
    [
      'a Baci-owned record plus an entry with an unreadable waybill',
      [record('WB-PRIVATE-1', BACI_ACCOUNT), { CustomerCode: BACI_ACCOUNT }],
    ],
    ['a missing record', null],
    ['a scalar payload', 'WB-PRIVATE-1'],
    [
      'more records than one booking can have',
      Array.from({ length: 21 }, () => record('WB-PRIVATE-1', BACI_ACCOUNT)),
    ],
  ])('bugfix: reports GIG as unavailable for %s instead of not_owned', async (_label, data) => {
    const { apiClient, io, log } = setupApi({ status: 200, data });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('unavailable');
    expectNoPrivateDataLogged(log);
  });

  it('compares against the account of the token GIG actually accepted', async () => {
    const { apiClient, io } = setupApi({});
    vi.spyOn(apiClient, 'safeFetchEnvelopeWithAccessToken').mockResolvedValue({
      envelope: { status: 200, data: record('WB-PRIVATE-1', BACI_ACCOUNT) },
      response: new Response('{}'),
      tokenData: { ...token, userChannelCode: 'ECO-REFRESHED' },
    });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('not_owned');
  });

  it('reports GIG as unavailable on HTTP errors without reading the provider body', async () => {
    const { apiClient, io, log } = setupApi(
      { data: record('WB-PRIVATE-1', BACI_ACCOUNT) },
      { status: 503 }
    );

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('unavailable');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'GIGL preshipment ownership check failed',
      { code: 'gigl_preshipment_http_error', status: 503 }
    );
    expectNoPrivateDataLogged(log);
  });

  it('reports GIG as unavailable on failure envelopes and malformed JSON', async () => {
    for (const body of [
      {
        status: 404,
        success: false,
        data: record('WB-PRIVATE-1', BACI_ACCOUNT),
      },
      'not json',
    ]) {
      const { apiClient, io, log } = setupApi(body);
      await expect(
        attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
      ).resolves.toBe('unavailable');
      expectNoPrivateDataLogged(log);
    }
  });

  it('reports GIG as unavailable on an oversized response', async () => {
    const { apiClient, io, log } = setupApi(
      { status: 200, data: record('WB-PRIVATE-1', BACI_ACCOUNT) },
      { status: 200, headers: { 'content-length': String(300 * 1_024) } }
    );

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('unavailable');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'GIGL preshipment ownership check failed',
      { code: 'gigl_preshipment_error' }
    );
  });

  it('reports GIG as unavailable when GIG login or the lookup times out', async () => {
    const { apiClient, io, log } = setupApi({});
    vi.spyOn(apiClient, 'getApiToken').mockRejectedValue(
      Object.assign(new Error('token timeout for WB-PRIVATE-1'), {
        name: 'TimeoutError',
      })
    );

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('unavailable');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'GIGL preshipment ownership check failed',
      { code: 'gigl_preshipment_timeout' }
    );
    expectNoPrivateDataLogged(log);
  });

  it('reports GIG as unavailable when the login carries no account code', async () => {
    const { apiClient, io, log } = setupApi({});
    vi.spyOn(apiClient, 'safeFetchEnvelopeWithAccessToken').mockResolvedValue({
      envelope: { status: 200, data: record('WB-PRIVATE-1', BACI_ACCOUNT) },
      response: new Response('{}'),
      tokenData: { ...token, userChannelCode: '  ' },
    });

    await expect(
      attestGiglWaybillOwnership(apiClient, io, 'WB-PRIVATE-1')
    ).resolves.toBe('unavailable');
    expect(log).toHaveBeenCalledWith(
      'warn',
      'GIGL preshipment ownership check failed',
      { code: 'gigl_preshipment_missing_account_code' }
    );
  });

  it('never calls GIG for a blank or overlong waybill', async () => {
    const { apiClient, io, safeFetch } = setupApi({});

    for (const waybill of ['   ', 'W'.repeat(129)]) {
      await expect(
        attestGiglWaybillOwnership(apiClient, io, waybill)
      ).resolves.toBe('not_owned');
    }
    expect(safeFetch).not.toHaveBeenCalled();
  });
});
