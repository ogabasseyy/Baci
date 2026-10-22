import { expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  enabled: false,
  claim: vi.fn(),
  run: vi.fn(),
  handler: vi.fn().mockResolvedValue(new Response('ok')),
  factory: vi.fn(),
}));
vi.mock('@/config/builder-private-storage', () => ({
  get BUILDER_PRIVATE_STORAGE_ENABLED() {
    return mocks.enabled;
  },
}));
vi.mock('@/lib/builder-ai/builder-ai-rate-limit', () => ({
  checkBuilderAiRateLimit: vi.fn(),
}));
vi.mock('@/lib/website-builder/claim-edit', () => ({
  claimStorefrontEdit: mocks.claim,
}));
vi.mock('@/lib/website-builder/run-edit', () => ({
  runStorefrontEdit: mocks.run,
}));
vi.mock('@/lib/website-builder/generate-edit', () => ({
  generateStorefrontEdit: vi.fn(),
}));
vi.mock('@/lib/website-builder/edit-user', () => ({
  authenticateEditUser: vi.fn(),
}));
vi.mock('@/lib/website-builder/edit-execution', () => ({
  createEditExecutionHandler: mocks.factory,
}));
it('blocks disabled execution before creating the authenticated handler', async () => {
  mocks.enabled = false;
  expect(
    (
      await POST(new Request('https://usebaci.com/api'), {
        params: Promise.resolve({ operationId: 'op' }),
      })
    ).status
  ).toBe(503);
  expect(mocks.factory).not.toHaveBeenCalled();
});
it('passes the operation binding to the handler and runs only a claimed lease', async () => {
  mocks.enabled = true;
  mocks.factory.mockReturnValue(mocks.handler);
  const req = new Request('https://usebaci.com/api');
  await POST(req, { params: Promise.resolve({ operationId: 'op' }) });
  expect(mocks.handler).toHaveBeenCalledWith(req, 'op');
  const deps = mocks.factory.mock.calls[0][0];
  mocks.claim.mockResolvedValue(null);
  await deps.execute({}, 'op');
  expect(mocks.run).not.toHaveBeenCalled();
  const lease = { operationId: 'op' };
  mocks.claim.mockResolvedValue(lease);
  await deps.execute({}, 'op');
  expect(mocks.run).toHaveBeenCalledWith(
    {},
    lease,
    expect.objectContaining({
      generate: expect.any(Function),
      rateLimit: expect.any(Function),
    })
  );
});

it('keeps the duration limit without a Cache Components-incompatible runtime export', async () => {
  const route = await import('./route');
  expect(route).not.toHaveProperty('runtime');
  expect(route.maxDuration).toBe(60);
});
