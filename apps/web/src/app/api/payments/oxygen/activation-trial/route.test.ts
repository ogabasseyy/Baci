import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  limit: vi.fn(),
  connect: vi.fn(),
  read: vi.fn(),
  run: vi.fn(),
  worker: vi.fn(),
  reconcile: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/payments/oxygen/activation-reconciliation', () => ({
  reconcileOxygenActivation: m.reconcile,
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: m.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: m.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: m.limit,
}));
vi.mock('@/lib/payments/oxygen/runtime-connection', () => ({
  connectOxygenRuntime: m.connect,
}));
vi.mock('@/lib/payments/oxygen/activation-trial', () => ({
  readOxygenActivationTrial: m.read,
  runOxygenActivationTrial: m.run,
}));

import { GET, POST } from './route';

const request = (reference = 'b75cd437-28af-4008-a1af-7e6810282833') =>
  new NextRequest('http://local/api/payments/oxygen/activation-trial', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([
      {
        reference: 'b75cd437-28af-4008-a1af-7e6810282833',
        workflowId: '52ab6696-762b-4e9f-8f99-a9d926a29b2c',
      },
      {
        reference: '1e65cf4b-4942-4ade-8149-e894687f6c40',
        workflowId: '1c0459fe-2d45-4d2c-b41a-0ac640ad9f89',
      },
    ])
  );
  vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', 'a'.repeat(64));
  m.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { rpc: vi.fn() },
  });
  m.csrf.mockResolvedValue({ valid: true });
  m.limit.mockResolvedValue(true);
  m.worker.mockResolvedValue({ rpc: vi.fn() });
  m.connect.mockReturnValue({
    worker: m.worker,
    activationTrialRequest: vi.fn(),
  });
  m.read.mockResolvedValue({ status: 'ready', result: {} });
});
it('authenticates and validates exact booking before worker or activation work', async () => {
  m.auth.mockResolvedValueOnce({ error: 'unauthorized' });
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request('another-booking'))).status).toBe(400);
  expect(m.worker).not.toHaveBeenCalled();
  expect(m.run).not.toHaveBeenCalled();
});
it('enforces CSRF and rate limits', async () => {
  m.csrf.mockResolvedValueOnce({ valid: false });
  expect((await POST(request())).status).toBe(403);
  m.limit.mockResolvedValueOnce(false);
  expect((await POST(request())).status).toBe(429);
  expect(m.run).not.toHaveBeenCalled();
});
it('checks ownership before worker login and returns only stored status', async () => {
  m.read.mockRejectedValueOnce(new Error('not owner'));
  expect((await POST(request())).status).toBe(409);
  expect(m.worker).not.toHaveBeenCalled();
  expect((await POST(request())).status).toBe(200);
  expect(m.run).toHaveBeenCalledTimes(1);
  expect(
    (
      await GET(
        new NextRequest(
          'http://local/api/payments/oxygen/activation-trial?reference=b75cd437-28af-4008-a1af-7e6810282833'
        )
      )
    ).status
  ).toBe(200);
});

it('resolves the current selected reference before accessing the worker', async () => {
  const reference = '1e65cf4b-4942-4ade-8149-e894687f6c40';
  expect((await POST(request(reference))).status).toBe(200);
  expect(m.read).toHaveBeenCalledWith(expect.anything(), reference);
  expect(m.run.mock.calls[0][4]).toBe(reference);
  expect(
    (
      await GET(
        new NextRequest(
          `http://local/api/payments/oxygen/activation-trial?reference=${reference}`
        )
      )
    ).status
  ).toBe(200);
  expect(m.read).toHaveBeenLastCalledWith(expect.anything(), reference);
});
it('rejects a valid but unauthorized booking UUID without worker access', async () => {
  expect(
    (await POST(request('70000000-0000-4000-8000-000000000001'))).status
  ).toBe(400);
  expect(m.worker).not.toHaveBeenCalled();
});

it('reconciles stored activation on POST without repeating the financial request', async () => {
  m.read.mockResolvedValue({
    status: 'activated',
    orderConfirmed: false,
    result: {},
  });
  m.read
    .mockResolvedValueOnce({
      status: 'activated',
      orderConfirmed: false,
      result: {},
    })
    .mockResolvedValueOnce({
      status: 'activated',
      orderConfirmed: false,
      result: {},
    })
    .mockResolvedValueOnce({
      status: 'activated',
      orderConfirmed: true,
      result: {},
    });
  m.reconcile.mockResolvedValue({ orderConfirmed: true });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect((await response.json()).orderConfirmed).toBe(true);
  expect(m.run).not.toHaveBeenCalled();
  expect(m.reconcile).toHaveBeenCalledTimes(1);
});
it('never writes reconciliation from GET even when confirmation is missing', async () => {
  m.read.mockResolvedValue({
    status: 'activated',
    orderConfirmed: false,
    result: {},
  });
  expect(
    (
      await GET(
        new NextRequest(
          'http://local/api/payments/oxygen/activation-trial?reference=b75cd437-28af-4008-a1af-7e6810282833'
        )
      )
    ).status
  ).toBe(200);
  expect(m.reconcile).not.toHaveBeenCalled();
  expect(m.worker).not.toHaveBeenCalled();
});

it('requires an explicit valid reference for status before connecting', async () => {
  expect(
    (
      await GET(
        new NextRequest('http://local/api/payments/oxygen/activation-trial')
      )
    ).status
  ).toBe(400);
  expect(
    (
      await GET(
        new NextRequest(
          'http://local/api/payments/oxygen/activation-trial?reference=invalid'
        )
      )
    ).status
  ).toBe(400);
  expect(m.connect).not.toHaveBeenCalled();
});
it('rejects an absent or invalid evidence key before ownership, worker or provider operations', async () => {
  for (const key of ['', 'invalid']) {
    vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', key);
    expect((await POST(request())).status).toBe(503);
  }
  expect(m.read).not.toHaveBeenCalled();
  expect(m.worker).not.toHaveBeenCalled();
  expect(m.run).not.toHaveBeenCalled();
});
it('does not permit trials with empty config or in production', async () => {
  vi.stubEnv('OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS', '');
  expect((await POST(request())).status).toBe(404);
  vi.stubEnv(
    'OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS',
    JSON.stringify([
      {
        reference: 'b75cd437-28af-4008-a1af-7e6810282833',
        workflowId: '52ab6696-762b-4e9f-8f99-a9d926a29b2c',
      },
    ])
  );
  vi.stubEnv('VERCEL_ENV', 'production');
  expect((await POST(request())).status).toBe(404);
  expect(m.worker).not.toHaveBeenCalled();
});
