import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const state = vi.hoisted(() => ({
  linking: true,
  storage: true,
  handler: vi.fn().mockResolvedValue(new Response('approved')),
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
vi.mock('@/lib/website-builder/publication-runtime', () => ({
  getOwnerPublicationRuntime: () => state.handler,
}));
afterEach(() => {
  state.linking = true;
  state.storage = true;
  state.handler.mockClear();
});
it('fails closed for either disabled release flag and keeps responses private', async () => {
  for (const flag of ['linking', 'storage'] as const) {
    state[flag] = false;
    const r = await POST(
      new NextRequest('https://usebaci.com/api/builder-publication')
    );
    expect(r.status).toBe(503);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');
    state[flag] = true;
  }
  expect(state.handler).not.toHaveBeenCalled();
});
it('delegates both verbs to the installed owner handler', async () => {
  const req = new NextRequest('https://usebaci.com/api/builder-publication');
  await GET(req);
  await POST(req);
  expect(state.handler).toHaveBeenNthCalledWith(1, req);
  expect(state.handler).toHaveBeenNthCalledWith(2, req);
});
