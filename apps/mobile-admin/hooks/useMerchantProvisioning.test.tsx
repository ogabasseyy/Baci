import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  apiClient: vi.fn(),
  captureMobileSignupLifecycle: vi.fn().mockResolvedValue(undefined),
  generateUUID: vi.fn(() => '123e4567-e89b-42d3-a456-426614174099'),
  getRuntimePlatform: vi.fn(),
  invalidateQueries: vi.fn(),
  user: {
    id: 'user-1',
    user_metadata: {
      signup_attempt_id: '123e4567-e89b-42d3-a456-426614174000',
      signup_flow: 'merchant',
    },
  },
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: mocks.apiClient,
  NetworkError: class NetworkError extends Error {
    readonly isOffline = false;
    readonly isTimeout = false;
    readonly statusCode = undefined;
  },
}));
vi.mock('@/config/runtime-platform', () => ({
  getRuntimePlatform: mocks.getRuntimePlatform,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock('@/services/signup-lifecycle-telemetry', () => ({
  captureMobileSignupLifecycle: mocks.captureMobileSignupLifecycle,
}));
vi.mock('@/utils/uuid', () => ({ generateUUID: mocks.generateUUID }));

import { useMerchantProvisioning } from './useMerchantProvisioning';

const payload = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '+2348012345678',
  businessName: 'Analytical Engines',
  businessType: 'technology',
  country: 'NG',
  slug: 'analytical-engines',
  slugIsCustom: true,
  logoUrl: 'https://cdn.usebaci.com/logo.png',
  brandColors: {
    primary: '#111111',
    background: '#ffffff',
    accent: '#f59e0b',
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 3 } },
  });
  client.invalidateQueries = mocks.invalidateQueries;
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useMerchantProvisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimePlatform.mockReturnValue('ios');
    mocks.user.user_metadata.signup_attempt_id =
      '123e4567-e89b-42d3-a456-426614174000';
    mocks.apiClient.mockResolvedValue({
      success: true,
      merchant: { id: 'merchant-1', slug: 'analytical-engines' },
      created: true,
    });
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  it.each([
    'ios',
    'android',
  ] as const)('posts authenticated store data with exact %s platform and awaits current-user refetch', async (platform) => {
    mocks.getRuntimePlatform.mockReturnValue(platform);
    const invalidation = Promise.withResolvers<void>();
    mocks.invalidateQueries.mockReturnValue(invalidation.promise);
    const { result } = renderHook(() => useMerchantProvisioning(), {
      wrapper,
    });

    let resolved = false;
    const mutation = act(async () => {
      const promise = result.current.mutateAsync(payload).then(() => {
        resolved = true;
      });
      await vi.waitFor(() => expect(mocks.apiClient).toHaveBeenCalled());
      expect(resolved).toBe(false);
      invalidation.resolve();
      await promise;
    });
    await mutation;

    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/mobile/merchant-provisioning',
      {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
          'X-Baci-Platform': platform,
          'X-Baci-Signup-Attempt-Id': '123e4567-e89b-42d3-a456-426614174000',
        },
      }
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant', 'user-1'],
      refetchType: 'active',
    });
    const serialized = JSON.stringify(mocks.apiClient.mock.calls[0]);
    for (const forbidden of [
      'email',
      'password',
      'confirmPassword',
      'userId',
      'merchantId',
      'signupSource',
      'rootDomain',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: '123e4567-e89b-42d3-a456-426614174000',
        eventCode: 'merchant_provisioning_started',
        flow: 'merchant',
        outcome: 'started',
        stage: 'provisioning',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'merchant_signup_completed',
        outcome: 'completed',
      })
    );
  });

  it('replaces untrusted metadata with a fresh opaque request correlation id', async () => {
    mocks.user.user_metadata.signup_attempt_id = 'owner@example.com';
    const { result } = renderHook(() => useMerchantProvisioning(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(mocks.generateUUID).toHaveBeenCalledOnce();
    expect(mocks.apiClient).toHaveBeenCalledWith(
      '/api/mobile/merchant-provisioning',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Baci-Signup-Attempt-Id': '123e4567-e89b-42d3-a456-426614174099',
        }),
      })
    );
    expect(JSON.stringify(mocks.apiClient.mock.calls)).not.toContain(
      'owner@example.com'
    );
  });

  it('reuses a generated fallback attempt ID when provisioning is retried', async () => {
    mocks.user.user_metadata.signup_attempt_id = 'owner@example.com';
    mocks.apiClient
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        success: true,
        merchant: { id: 'merchant-1', slug: 'analytical-engines' },
        created: true,
      });
    const { result } = renderHook(() => useMerchantProvisioning(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(payload)).rejects.toThrow(
        'temporary failure'
      );
      await result.current.mutateAsync(payload);
    });

    expect(mocks.generateUUID).toHaveBeenCalledOnce();
    expect(mocks.apiClient).toHaveBeenCalledTimes(2);
    expect(
      mocks.apiClient.mock.calls.map(
        ([, options]) =>
          (options as { headers: Record<string, string> }).headers[
            'X-Baci-Signup-Attempt-Id'
          ]
      )
    ).toEqual([
      '123e4567-e89b-42d3-a456-426614174099',
      '123e4567-e89b-42d3-a456-426614174099',
    ]);
    expect(
      mocks.captureMobileSignupLifecycle.mock.calls.map(
        ([input]) => (input as { attemptId: string }).attemptId
      )
    ).toEqual([
      '123e4567-e89b-42d3-a456-426614174099',
      '123e4567-e89b-42d3-a456-426614174099',
      '123e4567-e89b-42d3-a456-426614174099',
      '123e4567-e89b-42d3-a456-426614174099',
    ]);
  });

  it.each([
    'web',
    'windows',
  ])('rejects unsupported runtime %s before making a request', async (platform) => {
    mocks.getRuntimePlatform.mockReturnValue(platform);
    const { result } = renderHook(() => useMerchantProvisioning(), {
      wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync(payload)).rejects.toThrow(
        /unsupported mobile platform/i
      );
    });
    expect(mocks.apiClient).not.toHaveBeenCalled();
  });

  it('does not retry a provisioning failure', async () => {
    mocks.apiClient.mockRejectedValue(new Error('failed'));
    const { result } = renderHook(() => useMerchantProvisioning(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(payload)).rejects.toThrow(
        'failed'
      );
    });
    expect(mocks.apiClient).toHaveBeenCalledOnce();
    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'merchant_provisioning_failed',
        failureClass: 'unexpected',
        outcome: 'failed',
      })
    );
  });

  it('does not report completed provisioning as failed when cache invalidation rejects', async () => {
    mocks.invalidateQueries.mockRejectedValue(new Error('refetch failed'));
    const { result } = renderHook(() => useMerchantProvisioning(), { wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(payload)).rejects.toThrow(
        'refetch failed'
      );
    });

    expect(mocks.captureMobileSignupLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        eventCode: 'merchant_signup_completed',
        outcome: 'completed',
      })
    );
    expect(mocks.captureMobileSignupLifecycle).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventCode: 'merchant_provisioning_failed' })
    );
  });
});
