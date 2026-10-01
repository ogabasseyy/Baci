import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();
const mockUnstableRethrow = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}));

vi.mock('next/navigation', () => ({
  unstable_rethrow: (error: unknown) => mockUnstableRethrow(error),
}));

import {
  getPlatformAdminAuth,
  getPlatformAdminAuthForPermission,
  getPlatformAdminContextAuth,
} from './platform-admin-auth';

interface MockUser {
  email?: string | null;
  id: string;
}

function createSupabaseMock({
  contextResult = { data: [], error: null },
  user,
  userError = null,
}: {
  contextResult?: {
    data: unknown;
    error: { code?: string; message: string } | null;
  };
  user: MockUser | null;
  userError?: { message: string } | null;
}) {
  const getUser = vi.fn().mockResolvedValue({
    data: { user },
    error: userError,
  });
  const rpc = vi.fn().mockResolvedValue(contextResult);

  return {
    getUser,
    rpc,
    supabase: {
      auth: { getUser },
      rpc,
    },
  };
}

describe('platform admin authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks the authenticated user before resolving platform permissions', async () => {
    const supabaseMock = createSupabaseMock({
      contextResult: {
        data: [
          { role: 'owner', permissions: ['platform.read', 'settings.manage'] },
        ],
        error: null,
      },
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    const result = await getPlatformAdminAuth();

    expect(result).toEqual({
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    expect(supabaseMock.getUser).toHaveBeenCalledOnce();
    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      'get_platform_admin_context_v1'
    );
  });

  it('does not call the context RPC when there is no authenticated user', async () => {
    const supabaseMock = createSupabaseMock({ user: null });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(getPlatformAdminAuth()).resolves.toEqual({
      status: 'unauthenticated',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('accepts the live owner context for an account that owns multiple merchants', async () => {
    const supabaseMock = createSupabaseMock({
      contextResult: {
        data: [
          {
            role: 'owner',
            permissions: ['platform.read', 'financials.manage'],
          },
        ],
        error: null,
      },
      user: { email: 'owner@example.com', id: 'owner-of-many-merchants' },
    });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(
      getPlatformAdminAuthForPermission('financials.manage')
    ).resolves.toMatchObject({
      context: { role: 'owner' },
      status: 'authenticated',
    });
  });

  it('denies an ordinary merchant that has no platform context', async () => {
    const supabaseMock = createSupabaseMock({
      user: { email: 'merchant@example.com', id: 'merchant-user' },
    });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(getPlatformAdminAuth()).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('denies a revoked platform membership when the live context is empty', async () => {
    const supabaseMock = createSupabaseMock({
      user: { email: 'revoked@example.com', id: 'revoked-user' },
    });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(getPlatformAdminContextAuth()).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('keeps a legacy platform owner authenticated through the compatibility guard', async () => {
    const supabaseMock = createSupabaseMock({
      contextResult: {
        data: [
          {
            role: 'owner',
            permissions: ['platform.read', 'analytics.read'],
          },
        ],
        error: null,
      },
      user: { email: 'legacy@example.com', id: 'legacy-owner' },
    });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(getPlatformAdminAuth()).resolves.toEqual({
      status: 'authenticated',
      user: { email: 'legacy@example.com', id: 'legacy-owner' },
    });
  });

  it('fails closed when a role lacks the named permission', async () => {
    const supabaseMock = createSupabaseMock({
      contextResult: {
        data: [{ role: 'viewer', permissions: ['platform.read'] }],
        error: null,
      },
      user: { email: 'viewer@example.com', id: 'viewer-user' },
    });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(
      getPlatformAdminAuthForPermission('financials.manage')
    ).resolves.toEqual({ status: 'forbidden' });
  });

  it('preserves unauthenticated results for named permission guards', async () => {
    const supabaseMock = createSupabaseMock({ user: null });
    mockCreateClient.mockResolvedValue(supabaseMock.supabase);

    await expect(
      getPlatformAdminAuthForPermission('roles.manage')
    ).resolves.toEqual({ status: 'unauthenticated' });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the RPC errors or returns an invalid DTO', async () => {
    const rpcErrorMock = createSupabaseMock({
      contextResult: {
        data: null,
        error: { code: '42501', message: 'permission denied' },
      },
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    mockCreateClient.mockResolvedValueOnce(rpcErrorMock.supabase);

    await expect(getPlatformAdminAuth()).resolves.toEqual({
      status: 'forbidden',
    });

    const invalidDtoMock = createSupabaseMock({
      contextResult: {
        data: [{ role: 'owner', permissions: ['not-a-permission'] }],
        error: null,
      },
      user: { email: 'admin@example.com', id: 'user-1' },
    });
    mockCreateClient.mockResolvedValueOnce(invalidDtoMock.supabase);

    await expect(getPlatformAdminAuth()).resolves.toEqual({
      status: 'forbidden',
    });
  });

  it('fails closed for unexpected auth helper errors while preserving Next bailouts', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const authError = new Error('Supabase auth unavailable');
    mockCreateClient.mockRejectedValueOnce(authError);

    await expect(getPlatformAdminAuth()).resolves.toEqual({
      status: 'unauthenticated',
    });
    expect(mockUnstableRethrow).toHaveBeenCalledWith(authError);
    expect(errorLog).toHaveBeenCalledWith(
      '[platform-admin-auth] authorization lookup failed'
    );

    const dynamicBailoutError = new Error('DynamicServerError');
    mockCreateClient.mockRejectedValueOnce(dynamicBailoutError);
    mockUnstableRethrow.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(getPlatformAdminAuth()).rejects.toBe(dynamicBailoutError);
    errorLog.mockRestore();
  });
});
