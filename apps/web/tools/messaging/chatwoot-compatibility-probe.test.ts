import { describe, expect, it, vi } from 'vitest';
import type { ChatwootProbeInput } from './chatwoot-compatibility-probe';
import { runChatwootIsolationProbe } from './chatwoot-compatibility-probe';

const input: ChatwootProbeInput = {
  baseUrl: 'http://127.0.0.1:3000',
  accountAId: '11',
  accountAToken: 'TOKEN-A-SENTINEL',
  accountBId: '22',
  accountBToken: 'TOKEN-B-SENTINEL',
  conversationId: '123',
};

function response(status: number): Response {
  return new Response('PRIVATE-RESPONSE-SENTINEL', { status });
}

function requestPath(
  request: string | URL | Request | undefined
): string | undefined {
  if (!request) return undefined;
  if (request instanceof URL) return request.pathname;
  return new URL(typeof request === 'string' ? request : request.url).pathname;
}

describe('runChatwootIsolationProbe', () => {
  it('requires B’s own conversation list as a positive control before reporting a cross-token status', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(401));

    const result = await runChatwootIsolationProbe(input, fetcher);

    expect(result).toEqual({
      decision: 'unqualified',
      check: 'observed-status',
      outcome: 'cross-token-status-401-after-positive-controls',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([url]) => requestPath(url))).toEqual([
      '/api/v1/accounts/22/conversations',
      '/api/v1/accounts/11/conversations/123',
      '/api/v1/accounts/11/conversations/123',
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ api_access_token: input.accountBToken }),
      expect.objectContaining({ api_access_token: input.accountAToken }),
      expect.objectContaining({ api_access_token: input.accountBToken }),
    ]);
  });

  it('runs both positive controls before observing the cross-token detail status', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(404));

    const result = await runChatwootIsolationProbe(input, fetcher);

    expect(result).toEqual({
      decision: 'unqualified',
      check: 'observed-status',
      outcome: 'cross-token-status-404-after-positive-controls',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([url]) => url.toString())).toEqual([
      'http://127.0.0.1:3000/api/v1/accounts/22/conversations',
      'http://127.0.0.1:3000/api/v1/accounts/11/conversations/123',
      'http://127.0.0.1:3000/api/v1/accounts/11/conversations/123',
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(fetcher.mock.calls.map(([, init]) => init?.headers)).toEqual([
      expect.objectContaining({ api_access_token: input.accountBToken }),
      expect.objectContaining({ api_access_token: input.accountAToken }),
      expect.objectContaining({ api_access_token: input.accountBToken }),
    ]);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.2:3000',
    'http://127.0.0.1:3000/chatwoot',
    'http://user:pass@127.0.0.1:3000',
    'http://127.0.0.1:3000/?redirect=1',
    '',
  ])('refuses non-approved loopback URL %s without a request', async (baseUrl) => {
    const fetcher = vi.fn();
    const result = await runChatwootIsolationProbe(
      { ...input, baseUrl },
      fetcher
    );
    expect(result.outcome).toBe('invalid-configuration');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('accepts literal loopback host %s', async (baseUrl) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(403));
    const result = await runChatwootIsolationProbe(
      { ...input, baseUrl },
      fetcher
    );
    expect(result.check).toBe('observed-status');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('refuses missing, identical-account, or identical-token configuration before network access', async () => {
    const fetcher = vi.fn();
    const cases = [
      { ...input, accountAId: '' },
      { ...input, accountBId: input.accountAId },
      { ...input, accountBToken: input.accountAToken },
    ];
    for (const candidate of cases) {
      await expect(
        runChatwootIsolationProbe(candidate, fetcher)
      ).resolves.toMatchObject({
        check: 'unknown',
        outcome: 'invalid-configuration',
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses tokens that differ only by surrounding whitespace before network access', async () => {
    const fetcher = vi.fn();
    const result = await runChatwootIsolationProbe(
      { ...input, accountBToken: `${input.accountAToken} ` },
      fetcher
    );

    expect(result).toMatchObject({
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'invalid-configuration',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not treat an invalid B token as a cross-account status', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(401));
    const result = await runChatwootIsolationProbe(input, fetcher);
    expect(result).toMatchObject({
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'positive-control-failed',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(requestPath(fetcher.mock.calls[0]?.[0])).toBe(
      '/api/v1/accounts/22/conversations'
    );
  });

  it.each([
    401, 403, 404,
  ])('reports B detail HTTP %s only after both positive controls return 200', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(status));
    await expect(
      runChatwootIsolationProbe(input, fetcher)
    ).resolves.toMatchObject({
      decision: 'unqualified',
      check: 'observed-status',
      outcome: `cross-token-status-${status}-after-positive-controls`,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('reports cross-token HTTP 200 as an adverse status without qualifying the provider', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200));

    await expect(runChatwootIsolationProbe(input, fetcher)).resolves.toEqual({
      decision: 'unqualified',
      check: 'adverse-status',
      outcome: 'cross-token-status-200-after-positive-controls',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each([
    301, 302, 429, 500,
  ])('keeps B detail status %s unknown', async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(status));
    await expect(
      runChatwootIsolationProbe(input, fetcher)
    ).resolves.toMatchObject({
      decision: 'unqualified',
      check: 'unknown',
      outcome: 'unexpected-response',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps A baseline failures and request exceptions unknown and does not leak response data or tokens', async () => {
    const rejected = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200))
      .mockResolvedValueOnce(response(403));
    const failed = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('TOKEN-A-SENTINEL PRIVATE RESPONSE BODY'));
    const baseline = await runChatwootIsolationProbe(input, rejected);
    const requestFailure = await runChatwootIsolationProbe(input, failed);
    const serialized = JSON.stringify([baseline, requestFailure]);
    expect(baseline.outcome).toBe('positive-control-failed');
    expect(requestFailure.outcome).toBe('request-failed');
    expect(serialized).not.toContain('TOKEN-A-SENTINEL');
    expect(serialized).not.toContain('PRIVATE');
  });
});
