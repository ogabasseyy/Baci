import { afterEach, expect, it, vi } from 'vitest';
import { POST } from './route';

const state = vi.hoisted(() => ({
  linking: true,
  storage: true,
  gateway: vi.fn().mockResolvedValue(new Response('ok')),
}));
vi.mock('@/config/builder-linking', () => ({
  get BUILDER_ACCOUNT_LINKING_ENABLED() {
    return state.linking;
  },
}));
vi.mock('@/config/builder-private-storage', () => ({
  get BUILDER_PRIVATE_STORAGE_ENABLED() {
    return state.storage;
  },
}));
vi.mock('@/lib/builder-gateway/runtime', () => ({
  getInstalledBuilderGateway: () => state.gateway,
}));
afterEach(() => {
  state.linking = true;
  state.storage = true;
  state.gateway.mockClear();
});
it('denies disabled flags before tool dispatch', async () => {
  for (const flag of ['linking', 'storage'] as const) {
    state[flag] = false;
    const r = await POST(new Request('https://usebaci.com/api'), {
      params: Promise.resolve({ tool: 'list_storefronts' }),
    });
    expect(r.status).toBe(503);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    state[flag] = true;
  }
  expect(state.gateway).not.toHaveBeenCalled();
});
it('passes the original request and awaited tool name to the authenticated gateway', async () => {
  const req = new Request('https://usebaci.com/api');
  await POST(req, { params: Promise.resolve({ tool: 'list_storefronts' }) });
  expect(state.gateway).toHaveBeenCalledWith(req, 'list_storefronts');
});
