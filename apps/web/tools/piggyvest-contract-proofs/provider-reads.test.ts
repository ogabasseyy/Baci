import { afterEach, describe, expect, it, vi } from 'vitest';
import { build, KEY, ORIGIN } from './guarded-fetch.test-support';
import { ProviderReads } from './provider-reads';
import { HarnessRefusal } from './safety-guards';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

/** A ProviderReads wired to a canned transport through the real guarded fetch. */
function reads(
  respond: (url: string) => Response,
  config: { baseUrl: string } = { baseUrl: ORIGIN }
) {
  const built = build('live-readonly', respond);
  vi.stubGlobal('fetch', built.guarded);
  const api = new ProviderReads(
    { ...config, token: KEY },
    built.capture,
    built.gate
  );
  const urls = () =>
    built.baseFetch.mock.calls.map(([input]) => new URL(String(input)));
  return { api, urls, built };
}

const wallet = {
  id: 'w-1',
  api_customer_id: 'c-1',
  business_id: 'b-1',
  virtual_account_id: null,
  currency: 'NGN',
  name: 'x',
  status: 'active',
  type: 'api',
  balance: 100,
  withdrawal_count: 0,
  creation_interest_rate: 0,
  current_interest_rate: 0,
};

describe('ProviderReads: success paths', () => {
  it('returns status, data and envelope, and typed acceptance from the existing client', async () => {
    const { api } = reads(() =>
      json({ status: true, message: 'ok', data: wallet })
    );
    expect(await api.wallet('w-1')).toMatchObject({
      ok: true,
      httpStatus: 200,
      declined: false,
      errorCode: null,
      typedAccepted: true,
      data: { id: 'w-1' },
      envelope: { status: true },
    });
  });

  it('is ok with undefined data for a bare 202 "processing" envelope', async () => {
    const { api } = reads(() =>
      json({ status: true, message: 'processing' }, 202)
    );
    expect(await api.transaction('abc')).toMatchObject({
      ok: true,
      httpStatus: 202,
      data: undefined,
    });
  });

  it('flags a valid response that the existing typed schema rejects (ok but not typedAccepted)', async () => {
    const { api } = reads(() =>
      json({ status: true, message: 'ok', data: { id: 'w-1' } })
    );
    expect(await api.wallet('w-1')).toMatchObject({
      ok: true,
      typedAccepted: false,
    });
  });

  it('checks list and accrual responses against the existing schemas', async () => {
    const empty = {
      status: true,
      message: 'ok',
      data: {
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null, previousCursor: null },
      },
    };
    const { api } = reads(() => json(empty));
    expect((await api.transactions({ limit: '1' })).typedAccepted).toBe(true);
    const odd = reads(() =>
      json({ status: true, message: 'ok', data: { rows: [] } })
    );
    expect((await odd.api.transactions({})).typedAccepted).toBe(false);
    expect((await odd.api.accrued('w-1')).typedAccepted).toBe(false);
  });
});

describe('ProviderReads: request building', () => {
  it('sends the customer filter, ordering and page size', async () => {
    const { api, urls } = reads(() =>
      json({ status: true, message: 'ok', data: {} })
    );
    await api.customerWallets('c-1', 'ASC');
    const url = urls()[0];
    expect(url.pathname).toBe('/api/v1/wallet/api/wallet-type');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      customer_id: 'c-1',
      limit: '100',
      orderBy: 'ASC',
    });
  });

  it('defaults to DESC ordering', async () => {
    const { api, urls } = reads(() =>
      json({ status: true, message: 'ok', data: {} })
    );
    await api.customerWallets('c-1');
    expect(urls()[0].searchParams.get('orderBy')).toBe('DESC');
  });

  it('encodes ids and adds the wallet filter only when given', async () => {
    const { api, urls } = reads(() =>
      json({ status: true, message: 'ok', data: {} })
    );
    await api.transaction('a/b c');
    await api.transaction('t-1', 'w-9');
    expect(urls()[0].pathname).toBe('/api/v1/transaction/a%2Fb%20c');
    expect(urls()[0].searchParams.has('wallet_id')).toBe(false);
    expect(urls()[1].searchParams.get('wallet_id')).toBe('w-9');
  });

  it('looks customers up by third_party_identifier and verifies by reference', async () => {
    const { api, urls } = reads(() =>
      json({ status: false, message: 'Transaction not found' }, 404)
    );
    await api.customersByIdentifier('pvbproof:qa-1');
    await api.verify('ref-1');
    await api.verify('ref-2', 'w-2');
    expect(urls()[0].searchParams.get('third_party_identifier')).toBe(
      'pvbproof:qa-1'
    );
    expect(urls()[1].pathname).toBe('/api/v1/transaction/verify');
    expect(urls()[1].searchParams.has('wallet_id')).toBe(false);
    expect(urls()[2].searchParams.get('wallet_id')).toBe('w-2');
  });

  it('forwards accrual query parameters', async () => {
    const { api, urls } = reads(() =>
      json({ status: true, message: 'ok', data: {} })
    );
    await api.accrued('w-1', { interest_type: 'differential', limit: '1' });
    expect(urls()[0].pathname).toBe('/api/v1/wallet/interests/accrued/w-1');
    expect(urls()[0].searchParams.get('interest_type')).toBe('differential');
  });
});

describe('ProviderReads: error paths', () => {
  it('reports a provider decline with its message and status', async () => {
    const { api } = reads(() =>
      json({ status: false, message: 'Transaction not found' }, 404)
    );
    expect(await api.verify('ref')).toMatchObject({
      ok: false,
      httpStatus: 404,
      declined: true,
      message: 'Transaction not found',
      errorCode: 'PIGGYVEST_REQUEST_ERROR',
      typedAccepted: false,
    });
  });

  it('treats a 200 carrying status:false as not ok and declined', async () => {
    const { api } = reads(() => json({ status: false, message: 'nope' }, 200));
    expect(await api.transaction('t')).toMatchObject({
      ok: false,
      httpStatus: 200,
      declined: true,
    });
  });

  it('reports a non-JSON gateway error without inventing a message', async () => {
    const { api } = reads(
      () => new Response('<html>bad gateway</html>', { status: 502 })
    );
    expect(await api.wallet('w')).toMatchObject({
      ok: false,
      httpStatus: 502,
      declined: false,
      envelope: null,
      data: undefined,
      errorCode: 'PIGGYVEST_REQUEST_ERROR',
    });
  });

  it('reports a rejected key as an auth error', async () => {
    const { api } = reads(() =>
      json({ status: false, message: 'Unauthorized' }, 401)
    );
    expect(await api.wallet('w')).toMatchObject({
      ok: false,
      httpStatus: 401,
      errorCode: 'PIGGYVEST_AUTH_ERROR',
    });
  });

  it('reports a dropped connection with no http status', async () => {
    const { api } = reads(() => {
      throw new TypeError('fetch failed');
    });
    expect(await api.wallet('w')).toMatchObject({
      ok: false,
      httpStatus: null,
      declined: false,
      errorCode: 'PIGGYVEST_NETWORK_ERROR',
    });
  });

  it('rethrows a guard refusal even though the typed client wraps fetch errors', async () => {
    const { api, built } = reads(
      () => json({ status: true, message: 'ok', data: {} }),
      {
        baseUrl: 'https://api.piggyvest.business',
      }
    );
    await expect(api.wallet('w')).rejects.toBeInstanceOf(HarnessRefusal);
    await expect(api.wallet('w')).rejects.toMatchObject({
      code: 'HOST_NOT_ALLOWED',
    });
    expect(built.baseFetch).not.toHaveBeenCalled();
  });

  it('does not leak one call into the next (capture is reset per call)', async () => {
    let n = 0;
    const { api } = reads(() =>
      n++ === 0
        ? json({ status: true, message: 'ok', data: wallet })
        : new Response('x', { status: 500 })
    );
    expect((await api.wallet('w')).ok).toBe(true);
    const second = await api.wallet('w');
    expect(second).toMatchObject({
      ok: false,
      httpStatus: 500,
      data: undefined,
    });
  });
});
