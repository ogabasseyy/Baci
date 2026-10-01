import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPlatformAdminAuthForPermission: vi.fn(),
  createClient: vi.fn(),
  csrf: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: mocks.getPlatformAdminAuthForPermission,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.csrf,
}));

vi.mock('./admin-push-test-delivery', () => ({
  deliverAdminPushTest: mocks.deliver,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { POST } from './route';

function createRequest(body?: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/push/test', {
    body: JSON.stringify(body ?? {}),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('POST /api/admin/push/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPlatformAdminAuthForPermission.mockResolvedValue({
      context: { permissions: ['notifications.manage'], role: 'owner' },
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    mocks.createClient.mockResolvedValue({ from: vi.fn() });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.deliver.mockResolvedValue({ failed: 0, sent: 1 });
  });

  it('has no service-role or generic push-pipeline import edge', () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), 'src/app/api/admin/push/test/route.ts'),
      'utf8'
    );

    expect(routeSource).not.toContain('@/lib/supabase/admin');
    expect(routeSource).not.toContain('@/lib/expo-push');
    expect(routeSource).not.toContain('createAdminClient');
  });

  it('authorizes through the shared notification-admin boundary before CSRF or body parsing', async () => {
    mocks.getPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'unauthenticated',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('requires notifications.manage before CSRF validation or delivery', async () => {
    mocks.getPlatformAdminAuthForPermission.mockResolvedValue({
      status: 'forbidden',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('returns 403 when CSRF validation fails after authorization', async () => {
    mocks.csrf.mockResolvedValue({ valid: false, response: undefined });

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it('sends only to the authenticated notification manager devices', async () => {
    const response = await POST(
      createRequest({ body: 'Check delivery', title: 'Admin Push Test' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      failed: 0,
      sent: 1,
      status: 'sent',
    });
    expect(mocks.deliver).toHaveBeenCalledWith(
      { from: expect.any(Function) },
      'user-1',
      'Admin Push Test',
      'Check delivery'
    );
  });

  it('returns a stable error without provider or database details', async () => {
    mocks.deliver.mockRejectedValue(
      new Error('provider token database failure')
    );

    const response = await POST(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to send test notification',
    });
  });

  it('returns a stable validation error without Zod details', async () => {
    const response = await POST(
      createRequest({ body: 'x'.repeat(300), title: '' })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request data',
    });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
});
