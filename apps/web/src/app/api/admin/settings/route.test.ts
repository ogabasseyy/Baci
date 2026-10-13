import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsResponse } from '@/app/admin/settings/settings-test-fixture';
import type { PlatformSettingsResponse } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  csrf: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mocks.csrf(...args),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mocks.auth(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mocks.createClient(...args),
}));

import { GET, PUT } from './route';

const baseSettings: PlatformSettingsResponse = settingsResponse;

type RpcResult = { data: unknown; error: { message: string } | null };
let readResult: RpcResult;
let updateResult: RpcResult;
let rpc: ReturnType<typeof vi.fn>;

const authenticatedSettingsAdmin = {
  context: {
    permissions: ['settings.read', 'settings.manage'],
    role: 'owner',
  },
  status: 'authenticated' as const,
  user: { email: 'admin@example.com', id: 'admin-1' },
};

function createMockSupabase() {
  rpc = vi.fn((name: string, args?: unknown) => {
    if (name === 'get_admin_platform_settings_v1')
      return Promise.resolve(readResult);
    if (name === 'update_admin_platform_settings_v1') {
      return Promise.resolve(updateResult);
    }
    throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(args)}`);
  });
  return { rpc };
}

function createPutRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/settings', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
  }) as unknown as NextRequest;
}

describe('/api/admin/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readResult = { data: baseSettings, error: null };
    updateResult = { data: null, error: null };
    mocks.auth.mockResolvedValue(authenticatedSettingsAdmin);
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.createClient.mockResolvedValue(createMockSupabase());
  });

  it('reads only the safe permission-gated RPC projection', async () => {
    const response = await GET();
    const body = await response.json();

    expect(mocks.auth).toHaveBeenCalledWith('settings.read');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('get_admin_platform_settings_v1');
    expect(body).toEqual(baseSettings);
    expect(body).not.toHaveProperty('ga4_api_secret');
    expect(body).not.toHaveProperty('facebook_capi_token');
  });

  it.each([
    ['unauthenticated', 401, 'Unauthorized'],
    ['forbidden', 403, 'Forbidden'],
  ] as const)('returns %s before querying settings', async (status, expectedStatus, expectedError) => {
    mocks.auth.mockResolvedValueOnce({ status });
    const response = await GET();

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ error: expectedError });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('fails closed when the safe RPC returns a secret field', async () => {
    readResult = {
      data: { ...baseSettings, ga4_api_secret: 'secret' },
      error: null,
    };

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch settings',
    });
    expect(mocks.loggerError).toHaveBeenCalled();
  });

  it('authenticates before performing CSRF validation', async () => {
    const order: string[] = [];
    mocks.auth.mockImplementationOnce(async () => {
      order.push('auth');
      return authenticatedSettingsAdmin;
    });
    mocks.csrf.mockImplementationOnce(async () => {
      order.push('csrf');
      return { valid: true };
    });

    await PUT(createPutRequest({ platform_name: 'Baci Pro' }));

    expect(order).toEqual(['auth', 'csrf']);
  });

  it('stops before parsing or writing when CSRF validation fails', async () => {
    mocks.csrf.mockResolvedValueOnce({
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
      valid: false,
    });
    const request = createPutRequest({ platform_name: 'Baci Pro' });
    const jsonSpy = vi.spyOn(request, 'json');

    const response = await PUT(request);

    expect(response.status).toBe(403);
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'At least one setting must be provided'],
    [{ id: 'new-id' }, 'Invalid request payload'],
    [{ singleton_key: true }, 'Invalid request payload'],
    [{ created_at: '2026-08-05T00:00:00Z' }, 'Invalid request payload'],
    [{ platform_fee_percentage: 101 }, 'Invalid request payload'],
  ])('rejects empty, immutable, and invalid updates', async (payload, error) => {
    const response = await PUT(createPutRequest(payload));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('writes the validated payload through the narrow RPC then re-reads safely', async () => {
    const response = await PUT(
      createPutRequest({
        ga4_api_secret: 'replacement-secret',
        platform_name: 'Baci Pro',
      })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'update_admin_platform_settings_v1',
      {
        p_settings: {
          ga4_api_secret: 'replacement-secret',
          platform_name: 'Baci Pro',
        },
      }
    );
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_admin_platform_settings_v1');
    const body = await response.json();
    expect(body).toEqual(baseSettings);
    expect(body).not.toHaveProperty('ga4_api_secret');
  });

  it('does not report success when the narrow update RPC fails', async () => {
    updateResult = { data: null, error: { message: 'update failed' } };

    const response = await PUT(createPutRequest({ platform_name: 'Baci Pro' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update settings',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
