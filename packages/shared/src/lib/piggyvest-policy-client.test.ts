import { describe, expect, it, vi } from 'vitest';
import { createPiggyvestPolicyClient } from './piggyvest-policy-client';

const goalId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const draft = {
  status: 'draft',
  goalId,
  revisionId,
  device: {
    productName: 'Synthetic phone',
    variant: '256GB',
    condition: 'New',
  },
  terms: {
    version: 'synthetic-v1',
    hash: 'a'.repeat(64),
    text: 'Synthetic terms',
  },
  consent: 'required',
};
const acceptance = {
  goalId,
  revisionId,
  termsVersion: draft.terms.version,
  termsHash: draft.terms.hash,
  accepted: true,
};
const configuration = {
  mode: 'local_test',
  baseUrl: 'http://127.0.0.1:3000',
  endpointPath: '/local/policy',
};
const endpoint = `${configuration.baseUrl}${configuration.endpointPath}`;

function response(value: unknown, url: string, options: ResponseInit = {}) {
  const result = new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
function fixture() {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (url, init) =>
      response(
        init?.method === 'POST' ? { ...draft, consent: 'accepted' } : draft,
        String(url)
      )
    );
  const getCsrfToken = vi.fn(async () => 'synthetic-csrf');
  return {
    fetch,
    getCsrfToken,
    client: createPiggyvestPolicyClient({ configuration, fetch, getCsrfToken }),
  };
}

describe('bounded local policy HTTP client', () => {
  it.each([
    [3, 3, true],
    [3, undefined, false],
    [undefined, 3, false],
    [3, 4, false],
  ] as const)('compares requested duration %s with response %s', async (requested, received, succeeds) => {
    const test = fixture();
    test.fetch.mockResolvedValueOnce(
      response(
        {
          ...draft,
          consent: 'accepted',
          ...(received === undefined ? {} : { durationMonths: received }),
        },
        endpoint
      )
    );
    const pending = test.client.submit({
      ...acceptance,
      ...(requested === undefined ? {} : { durationMonths: requested }),
    });
    if (succeeds) {
      await expect(pending).resolves.toMatchObject({
        durationMonths: requested,
      });
      expect(
        JSON.parse(String(test.fetch.mock.calls[0][1]?.body))
      ).toMatchObject({ durationMonths: requested });
    } else await expect(pending).rejects.toThrow('Policy unavailable');
  });
  it('normalizes UUID casing without changing acceptance correlation', async () => {
    const test = fixture();
    const mixedGoal = 'abcdefab-1111-4111-8111-111111111111';
    const mixedRevision = 'abcdefab-2222-4222-8222-222222222222';
    test.fetch.mockResolvedValueOnce(
      response(
        {
          ...draft,
          goalId: mixedGoal,
          revisionId: mixedRevision,
          consent: 'accepted',
        },
        endpoint
      )
    );
    const result = await test.client.submit({
      ...acceptance,
      goalId: mixedGoal.toUpperCase(),
      revisionId: mixedRevision.toUpperCase(),
    });
    expect(result).toMatchObject({
      goalId: mixedGoal,
      revisionId: mixedRevision,
    });
    expect(JSON.parse(String(test.fetch.mock.calls[0][1]?.body))).toMatchObject(
      { goalId: mixedGoal, revisionId: mixedRevision }
    );
  });
  it.each([
    { revisionId: goalId },
    { terms: { ...draft.terms, hash: 'b'.repeat(64) } },
    { terms: { ...draft.terms, version: 'different' } },
  ])('rejects acceptance correlation mismatch %j', async (change) => {
    const test = fixture();
    test.fetch.mockResolvedValueOnce(
      response({ ...draft, consent: 'accepted', ...change }, endpoint)
    );
    await expect(test.client.submit(acceptance)).rejects.toThrow(
      'Policy unavailable'
    );
  });
  it('loads the exact goal with injected fetch and no ambient credentials', async () => {
    const test = fixture();
    await expect(test.client.load(goalId)).resolves.toEqual(draft);
    expect(test.fetch).toHaveBeenCalledWith(
      `${endpoint}?goalId=${goalId}`,
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        mode: 'same-origin',
      })
    );
    expect(test.getCsrfToken).not.toHaveBeenCalled();
    expect(test.fetch.mock.calls[0][1]?.headers).toEqual({
      Accept: 'application/json',
    });
  });
  it('posts exact acceptance and an injected CSRF token, requiring recorded acceptance', async () => {
    const test = fixture();
    await expect(test.client.submit(acceptance)).resolves.toEqual({
      ...draft,
      consent: 'accepted',
    });
    expect(test.fetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-csrf-token': 'synthetic-csrf',
        },
      })
    );
    expect(JSON.parse(String(test.fetch.mock.calls[0][1]?.body))).toEqual(
      acceptance
    );
  });
  it.each([
    'https://example.com:443',
    'http://127.1:3000',
    'http://user@127.0.0.1:3000',
    'http://127.0.0.1:3000/other',
    'http://localhost.evil:3000',
    'http://10.0.2.2:3000',
  ])('rejects noncanonical/nonloopback base %s before transport', (baseUrl) => {
    expect(() =>
      createPiggyvestPolicyClient({
        configuration: { ...configuration, baseUrl },
        fetch: vi.fn(),
        getCsrfToken: vi.fn(),
      })
    ).toThrow('Policy unavailable');
  });
  it('allows explicit cookie mode but never a bearer/header configuration', async () => {
    const test = fixture();
    const client = createPiggyvestPolicyClient({
      configuration: { ...configuration, credentials: 'include' },
      fetch: test.fetch,
      getCsrfToken: test.getCsrfToken,
    });
    await client.load(goalId);
    expect(test.fetch.mock.calls[0][1]?.credentials).toBe('include');
    expect(() =>
      createPiggyvestPolicyClient({
        configuration: { ...configuration, authorization: 'forbidden' },
        fetch: test.fetch,
        getCsrfToken: test.getCsrfToken,
      })
    ).toThrow();
  });
  it('rejects malformed requests before fetching or obtaining CSRF', async () => {
    const test = fixture();
    await expect(test.client.load('bad')).rejects.toThrow('Policy unavailable');
    await expect(
      test.client.submit({ ...acceptance, actorId: goalId })
    ).rejects.toThrow('Policy unavailable');
    expect(test.fetch).not.toHaveBeenCalled();
    expect(test.getCsrfToken).not.toHaveBeenCalled();
  });
  it.each([
    { ...draft, goalId: revisionId },
    { ...draft, providerWalletId: 'private' },
    { ...draft, consent: 'required' },
    { status: 'unavailable' },
  ])('never infers acceptance from status 200 with %j', async (body) => {
    const test = fixture();
    test.fetch.mockResolvedValueOnce(response(body, endpoint));
    await expect(test.client.submit(acceptance)).rejects.toThrow(
      'Policy unavailable'
    );
  });
  it('redacts non-2xx and transport errors without retries', async () => {
    const test = fixture();
    test.fetch
      .mockResolvedValueOnce(
        response(
          { error: 'private response' },
          `${endpoint}?goalId=${goalId}`,
          { status: 403 }
        )
      )
      .mockRejectedValueOnce(new Error('private transport'));
    await expect(test.client.load(goalId)).rejects.toThrow(
      /^Policy unavailable$/
    );
    await expect(test.client.load(goalId)).rejects.toThrow(
      /^Policy unavailable$/
    );
    expect(test.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects redirect responses even if an injected transport followed them', async () => {
    const test = fixture();
    const redirected = response(draft, 'https://example.test/stolen');
    Object.defineProperty(redirected, 'redirected', { value: true });
    test.fetch.mockResolvedValueOnce(redirected);
    await expect(test.client.load(goalId)).rejects.toThrow(
      'Policy unavailable'
    );
  });
  it('stops before fetch when aborted during CSRF acquisition', async () => {
    let finish: (value: string) => void = () => undefined;
    const csrf = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const test = fixture();
    test.getCsrfToken.mockReturnValueOnce(csrf);
    const abort = new AbortController();
    const pending = test.client.submit(acceptance, abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow('Policy unavailable');
    finish('synthetic-csrf');
    expect(test.fetch).not.toHaveBeenCalled();
  });
  it('rejects stale completions', async () => {
    let current = true;
    const test = fixture();
    test.fetch.mockImplementationOnce(async (url) => {
      current = false;
      return response(draft, String(url));
    });
    const client = createPiggyvestPolicyClient({
      configuration,
      fetch: test.fetch,
      getCsrfToken: test.getCsrfToken,
      isCurrent: () => current,
    });
    await expect(client.load(goalId)).rejects.toThrow('Policy unavailable');
  });
  it('bounds an unresponsive injected transport without retrying', async () => {
    vi.useFakeTimers();
    try {
      const test = fixture();
      test.fetch.mockReturnValueOnce(new Promise(() => undefined));
      const pending = expect(test.client.load(goalId)).rejects.toThrow(
        'Policy unavailable'
      );
      await vi.advanceTimersByTimeAsync(5000);
      await pending;
      expect(test.fetch).toHaveBeenCalledTimes(1);
      expect(test.fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects pre-aborted requests without fetching', async () => {
    const test = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(test.client.load(goalId, controller.signal)).rejects.toThrow(
      'Policy unavailable'
    );
    expect(test.fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid CSRF before sending acceptance', async () => {
    const test = fixture();
    test.getCsrfToken.mockResolvedValueOnce('bad\r\ntoken');
    await expect(test.client.submit(acceptance)).rejects.toThrow(
      'Policy unavailable'
    );
    expect(test.fetch).not.toHaveBeenCalled();
  });
});
