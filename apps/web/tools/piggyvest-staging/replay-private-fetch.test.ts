import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrivateReplayFetch } from './replay-private-fetch';

afterEach(() => vi.restoreAllMocks());

describe('createPrivateReplayFetch', () => {
  it.each([
    ['receipt', '4792', 'pvb-staging-receipts-rest'],
    ['app', '4793', 'baci-isolated-savings-rest-1'],
  ] as const)('rewrites only the fixed %s upstream', async (target, port, host) => {
    const response = new Response('synthetic');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const transport = createPrivateReplayFetch(target, fetcher);
    expect(
      await transport(
        `http://127.0.0.1:${port}/rest/v1/rpc/piggyvest_staging_system_id`,
        { method: 'POST' }
      )
    ).toBe(response);
    const [input, init] = fetcher.mock.calls[0];
    const forwarded = new Request(input, init);
    expect(forwarded.url).toBe(
      `http://${host}:3000/rpc/piggyvest_staging_system_id`
    );
    expect(forwarded.redirect).toBe('error');
  });

  it.each([
    'string',
    'URL',
    'Request',
  ])('preserves method headers and exact body for %s', async (kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const url =
      'http://127.0.0.1:4792/rest/v1/rpc/claim_piggyvest_staging_receipts';
    const options = {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic',
        'content-type': 'application/octet-stream',
      },
      body: new Uint8Array([0, 255, 13, 10]),
      redirect: 'follow' as const,
    };
    const input =
      kind === 'Request'
        ? new Request(url, options)
        : kind === 'URL'
          ? new URL(url)
          : url;
    await createPrivateReplayFetch('receipt', fetcher)(
      input,
      kind === 'Request' ? undefined : options
    );
    const [forwardedInput, init] = fetcher.mock.calls[0];
    const forwarded = new Request(forwardedInput, init);
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('authorization')).toBe('Bearer synthetic');
    expect(forwarded.headers.get('content-type')).toBe(
      'application/octet-stream'
    );
    expect(new Uint8Array(await forwarded.arrayBuffer())).toEqual(options.body);
    expect(forwarded.redirect).toBe('error');
  });

  it('honors Request init overrides', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const request = new Request(
      'http://127.0.0.1:4792/rest/v1/rpc/resolve_piggyvest_staging_receipt',
      {
        method: 'PATCH',
        body: 'old',
        headers: { authorization: 'old' },
      }
    );
    await createPrivateReplayFetch('receipt', fetcher)(request, {
      method: 'POST',
      body: 'new',
      headers: { authorization: 'new' },
      redirect: 'manual',
    });
    const [input, init] = fetcher.mock.calls[0];
    const forwarded = new Request(input, init);
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('authorization')).toBe('new');
    expect(await forwarded.text()).toBe('new');
    expect(forwarded.redirect).toBe('error');
  });

  it.each([
    'https://127.0.0.1:4792/rest/v1/items',
    'http://localhost:4792/rest/v1/items',
    'http://127.0.0.1:4793/rest/v1/items',
    'http://evil.example/rest/v1/items',
    'http://127.0.0.1:4792/rest/v10/items',
    'http://127.0.0.1:4792/rest/v1',
    'http://127.0.0.1:4792/rest/v1/../../admin',
    'http://127.0.0.1:4792/admin',
    'http://secret:password@127.0.0.1:4792/rest/v1/items',
    'not a URL',
  ])('refuses disallowed input %s before fetching', async (input) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createPrivateReplayFetch('receipt', fetcher)(input)
    ).rejects.toThrow('Private replay request failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('denies receipt origin for app transport', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createPrivateReplayFetch(
        'app',
        fetcher
      )('http://127.0.0.1:4792/rest/v1/items')
    ).rejects.toThrow('Private replay request failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'init',
    'Request',
  ])('combines timeout with the %s caller signal', async (kind) => {
    const deadline = new AbortController();
    const caller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const url =
      'http://127.0.0.1:4793/rest/v1/rpc/resolve_piggyvest_staging_goal_mapping';
    const options = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    };
    await createPrivateReplayFetch('app', fetcher)(
      kind === 'Request'
        ? new Request(url, { ...options, signal: caller.signal })
        : url,
      kind === 'init' ? { ...options, signal: caller.signal } : undefined
    );
    const [input, init] = fetcher.mock.calls[0];
    const forwarded = new Request(input, init);
    expect(timeout).toHaveBeenCalledWith(15000);
    expect(forwarded.signal.aborted).toBe(false);
    caller.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it('aborts forwarding when the deadline expires', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    await createPrivateReplayFetch('receipt', fetcher)(
      'http://127.0.0.1:4792/rest/v1/rpc/piggyvest_staging_system_id',
      { method: 'POST' }
    );
    const [input, init] = fetcher.mock.calls[0];
    const forwarded = new Request(input, init);
    deadline.abort();
    expect(forwarded.signal.aborted).toBe(true);
  });

  it.each([
    ['receipt', 'quarantine_piggyvest_staging_receipt'],
    ['app', 'recognize_piggyvest_staging_inflow'],
    ['app', 'resolve_piggyvest_staging_goal_mapping'],
  ] as const)('allows %s RPC %s', async (target, rpc) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const port = target === 'receipt' ? 4792 : 4793;
    await createPrivateReplayFetch(target, fetcher)(
      `http://127.0.0.1:${port}/rest/v1/rpc/${rpc}`,
      { method: 'POST' }
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['receipt', 'PATCH', '/rpc/resolve_piggyvest_staging_receipt'],
    ['receipt', 'POST', '/piggyvest_staging_receipts'],
    ['receipt', 'POST', '/rpc/recognize_piggyvest_staging_inflow'],
    ['receipt', 'GET', '/piggyvest_plan_wallets'],
    ['receipt', 'GET', '/rpc/piggyvest_staging_system_id'],
    ['app', 'POST', '/rpc/claim_piggyvest_staging_receipts'],
    ['app', 'POST', '/rpc/quarantine_piggyvest_staging_receipt'],
    ['app', 'POST', '/rpc/resolve_piggyvest_staging_receipt'],
    ['app', 'GET', '/piggyvest_plan_wallets'],
    ['app', 'PATCH', '/piggyvest_plan_wallets'],
    ['app', 'POST', '/piggyvest_plan_wallets'],
    ['app', 'DELETE', '/piggyvest_plan_wallets'],
    ['app', 'HEAD', '/piggyvest_plan_wallets'],
    ['app', 'GET', '/other_table'],
    ['app', 'GET', '/piggyvest_plan_wallets/'],
    ['app', 'POST', '/rpc/recognize_piggyvest_staging_inflow?select=id'],
  ] as const)('refuses %s %s %s without fetching', async (target, method, path) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response());
    const port = target === 'receipt' ? 4792 : 4793;
    await expect(
      createPrivateReplayFetch(target, fetcher)(
        `http://127.0.0.1:${port}/rest/v1${path}`,
        { method }
      )
    ).rejects.toThrow('Private replay request failed');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sanitizes fetch errors without retaining a cause', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('secret URL and body'));
    const result = createPrivateReplayFetch('receipt', fetcher)(
      'http://127.0.0.1:4792/rest/v1/rpc/piggyvest_staging_system_id',
      { method: 'POST' }
    );
    await expect(result).rejects.toThrow(/^Private replay request failed$/);
    await expect(result).rejects.not.toHaveProperty('cause');
  });
});
