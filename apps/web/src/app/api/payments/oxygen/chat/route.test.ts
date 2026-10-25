import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  getBearerTokenFromRequest: (r: Request) =>
    r.headers.get('Authorization')?.match(/^bearer\s+(.+)$/i)?.[1] ?? null,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/ensure-action-rate-limit', () => ({
  ensureActionRateLimit: mocks.rate,
}));

import { POST } from './route';

const orderId = '8bb42a9f-9fb5-4ab4-a546-670e28f005f9';
const body = {
  orderId,
  messageId: 'webchat-1',
  channel: 'webchat',
  intent: 'resume',
};
const snapshot = {
  id: orderId,
  order_id: orderId,
  version: 4,
  stage: 'kyc_required',
  environment: 'staging',
  created_at: '2026-10-22',
  updated_at: '2026-10-22',
};
const request = (input: unknown = body, bearer = false) =>
  new NextRequest('https://shop.example/api/payments/oxygen/chat', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: bearer ? { Authorization: 'Bearer normal-customer-session' } : {},
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rate.mockResolvedValue(true);
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.auth.mockResolvedValue({
    user: { id: 'customer' },
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
});
describe('authenticated Oxygen chat continuation', () => {
  it('resumes the same owned order across channels without financial commands', async () => {
    const first = await POST(request());
    const second = await POST(
      request({ ...body, channel: 'whatsapp', intent: 'status' }, true)
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).application.workflowId).toBe(
      (await second.json()).application.workflowId
    );
    for (const call of mocks.rpc.mock.calls)
      expect(call).toEqual([
        'oxygen_start_workflow',
        { p_order_id: orderId, p_channel: 'chat' },
      ]);
    expect(first.headers.get('cache-control')).toBe('no-store');
  });
  it('makes duplicate deliveries harmless and always disables activation and settlement', async () => {
    const one = await (await POST(request())).json();
    const two = await (await POST(request())).json();
    expect(one).toEqual(two);
    expect(one).toMatchObject({
      activationEnabled: false,
      settlementEnabled: false,
    });
    expect(
      mocks.rpc.mock.calls.every(([name]) => name === 'oxygen_start_workflow')
    ).toBe(true);
  });
  it('does not trust a WhatsApp channel as customer authentication', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'Invalid token' });
    expect(
      (await POST(request({ ...body, channel: 'whatsapp' }, true))).status
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires CSRF for cookies and bypasses only after bearer authentication', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await POST(request(body, true))).status).toBe(200);
    expect(mocks.csrf).toHaveBeenCalledTimes(1);
  });
  it('does not bypass cookie CSRF for an empty bearer header', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    const invalid = new NextRequest(
      'https://shop.example/api/payments/oxygen/chat',
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { Authorization: 'Bearer ' },
      }
    );
    expect((await POST(invalid)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('conceals ownership denial and database text', async () => {
    mocks.rpc.mockResolvedValue({
      error: { code: '42501', message: 'private' },
      data: null,
    });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Application not found' });
  });
  it.each([
    'activate',
    'approve_booking',
    'book',
    'settle',
  ])('rejects forbidden %s intents before database access', async (intent) => {
    expect((await POST(request({ ...body, intent }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects identity data and malformed JSON', async () => {
    expect((await POST(request({ ...body, bvn: 'secret' }))).status).toBe(400);
    const invalid = new NextRequest(
      'https://shop.example/api/payments/oxygen/chat',
      { method: 'POST', body: '{bad' }
    );
    expect((await POST(invalid)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {
      data: { ...snapshot, order_id: '11111111-1111-4111-8111-111111111111' },
      error: null,
    },
    { data: { ...snapshot, environment: 'production' }, error: null },
    { data: null, error: null },
    { data: null, error: { code: 'other', message: 'secret' } },
  ])('fails closed for unavailable or mismatched storage', async (result) => {
    mocks.rpc.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('returns safe conflict for unavailable orders', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023' } });
    expect((await POST(request())).status).toBe(409);
  });
  it('handles unavailable storage and rate limits', async () => {
    mocks.rpc.mockRejectedValue(new Error('private'));
    expect((await POST(request())).status).toBe(503);
    mocks.rate.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(429);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });
});
