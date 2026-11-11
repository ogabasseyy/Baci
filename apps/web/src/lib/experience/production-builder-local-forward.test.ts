// @vitest-environment node
import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createProductionBuilderLocalForward } from './production-builder-local-forward';

it('forwards only the fixed builder endpoint with the original bearer and tool body', async () => {
  const gateway = vi.fn(async (request: Request, tool: string) => {
    expect(request.url).toBe(
      'https://usebaci.com/api/integrations/chatgpt/builder/list_storefronts'
    );
    expect(request.headers.get('authorization')).toBe('Bearer synthetic.token');
    expect(await request.json()).toEqual({});
    return Response.json({ tool, ok: true });
  });
  const execute = createProductionBuilderLocalForward(() => gateway);
  await expect(
    execute('synthetic.token', 'list_storefronts', {})
  ).resolves.toEqual({ tool: 'list_storefronts', ok: true });
  expect(gateway).toHaveBeenCalledOnce();
});

it('fails closed when the gateway is not installed and rejects unknown tools', async () => {
  const execute = createProductionBuilderLocalForward(() => undefined);
  await expect(
    execute('synthetic.token', 'list_storefronts', {})
  ).rejects.toThrow();
  await expect(
    execute('synthetic.token', '../other' as never, {})
  ).rejects.toThrow();
});

it('propagates an already-aborted request without calling the gateway', async () => {
  const gateway = vi.fn(async () => Response.json({}));
  const execute = createProductionBuilderLocalForward(() => gateway);
  const controller = new AbortController();
  controller.abort();
  await expect(
    execute('synthetic.token', 'list_storefronts', {}, controller.signal)
  ).rejects.toThrow();
  expect(gateway).not.toHaveBeenCalled();
});
