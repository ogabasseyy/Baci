import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.rate,
}));

import { POST } from './route';

const orderId = '8bb42a9f-9fb5-4ab4-a546-670e28f005f9';
const request = (body: unknown) =>
  new NextRequest('http://localhost/api/payments/oxygen/workflows', {
    method: 'POST',
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rate.mockResolvedValue(true);
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.auth.mockResolvedValue({
    user: { id: 'user' },
    supabase: { rpc: mocks.rpc },
  });
});
describe('Oxygen workflow draft route', () => {
  it('creates or resumes only the authenticated order and advertises no execution', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: orderId,
        order_id: orderId,
        version: 0,
        stage: 'application_required',
        environment: 'staging',
        created_at: '2026-10-20',
        updated_at: '2026-10-20',
      },
      error: null,
    });
    const response = await POST(request({ orderId, channel: 'chat' }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('oxygen_start_workflow', {
      p_order_id: orderId,
      p_channel: 'chat',
    });
    expect(await response.json()).toMatchObject({
      executionEnabled: false,
      settlement: 'unverified',
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it.each([
    'environment',
    'merchant_id',
    'stage',
    'payment_completed',
  ])('rejects client-supplied %s', async (field) => {
    expect(
      (await POST(request({ orderId, channel: 'web', [field]: true }))).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('blocks anonymous calls', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'Unauthorized' });
    expect((await POST(request({ orderId, channel: 'mobile' }))).status).toBe(
      401
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('conceals ownership denial and private errors', async () => {
    mocks.rpc.mockResolvedValue({
      error: { code: '42501', message: 'sensitive details' },
    });
    const response = await POST(request({ orderId, channel: 'web' }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Order not found' });
  });
  it('fails closed if migrations are missing or response shape is wrong', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(request({ orderId, channel: 'web' }))).status).toBe(503);
  });
  it('enforces CSRF and rate limits before storage access', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await POST(request({ orderId, channel: 'web' }))).status).toBe(403);
    mocks.rate.mockResolvedValue(false);
    expect((await POST(request({ orderId, channel: 'web' }))).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
