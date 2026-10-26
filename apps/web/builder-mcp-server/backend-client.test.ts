// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createBuilderBackendClient } from './backend-client';

describe('fixed HTTPS execution client', () => {
  it('forwards only the outer token to the fixed route, with redirects disabled', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(Response.json({ stores: [], nextCursor: null }));
    const execute = createBuilderBackendClient({ fetchImpl });
    expect(await execute('outer.fixture', 'list_storefronts', {})).toEqual({
      stores: [],
      nextCursor: null,
    });
    expect(fetchImpl.mock.calls[0]).toMatchObject([
      'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts',
      {
        method: 'POST',
        redirect: 'manual',
        headers: expect.objectContaining({
          authorization: 'Bearer outer.fixture',
        }),
      },
    ]);
  });
  it('rejects redirects, oversized bodies, HTML and untrusted origins/tools', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'https://evil.test' },
      })
    );
    const execute = createBuilderBackendClient({ fetchImpl });
    await expect(
      execute('outer.fixture', 'list_storefronts', {})
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    fetchImpl.mockResolvedValue(
      new Response('x'.repeat(150000), {
        headers: { 'content-type': 'application/json' },
      })
    );
    await expect(
      execute('outer.fixture', 'list_storefronts', {})
    ).rejects.toThrow();
    fetchImpl.mockClear();
    await expect(
      execute('outer.fixture', 'https://evil.test' as 'list_storefronts', {})
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('maps authentication failures to the exact reauthorization code without raw errors', async () => {
    const execute = createBuilderBackendClient({
      fetchImpl: vi
        .fn()
        .mockResolvedValue(Response.json({ token: 'never' }, { status: 403 })),
    });
    expect(
      await execute('outer.fixture', 'list_storefronts', {})
    ).toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });
});
