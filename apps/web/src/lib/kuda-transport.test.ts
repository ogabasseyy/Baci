import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateRequestRef,
  KudaServiceType,
  kudaRequest,
} from './kuda-transport';

function stubTokenAndApi(apiBody: unknown) {
  // Route by URL: the module caches the token across tests, so
  // later tests skip the GetToken call entirely.
  const fetchMock = vi.fn((url: string) => {
    if (String(url).endsWith('/Account/GetToken')) {
      return Promise.resolve(new Response('test-token'));
    }
    return Promise.resolve(Response.json(apiBody));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('kuda-transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('generates punctuation-free 24-char hex references', () => {
    const ref = generateRequestRef();

    expect(ref).toMatch(/^[0-9a-f]{24}$/);
    expect(generateRequestRef()).not.toBe(ref);
  });

  it('sends the service payload with a bearer token', async () => {
    const fetchMock = stubTokenAndApi({ status: true, message: 'ok' });

    const result = await kudaRequest(KudaServiceType.BANK_LIST, {}, 'ref-1');

    expect(result).toEqual({ status: true, message: 'ok', data: undefined });
    const apiCall = fetchMock.mock.calls.find(
      ([url]) => !String(url).endsWith('/Account/GetToken')
    ) as unknown as [string, { body: string; headers: Record<string, string> }];
    const [, apiInit] = apiCall;
    expect(apiInit.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(apiInit.body)).toEqual({
      serviceType: 'BANK_LIST',
      requestRef: 'ref-1',
      Data: {},
    });
  });

  it('normalizes PascalCase envelopes to camelCase', async () => {
    stubTokenAndApi({ Status: true, Message: 'ok', Data: { a: 1 } });

    const result = await kudaRequest(KudaServiceType.BANK_LIST);

    expect(result).toEqual({ status: true, message: 'ok', data: { a: 1 } });
  });

  it('merges dual data/Data payloads with Data winning', async () => {
    stubTokenAndApi({
      status: true,
      message: 'ok',
      data: { a: 1, shared: 'lower' },
      Data: { b: 2, shared: 'upper' },
    });

    const result = await kudaRequest(KudaServiceType.VERIFY_BILL_CUSTOMER);

    expect(result.data).toEqual({ a: 1, b: 2, shared: 'upper' });
  });
});
