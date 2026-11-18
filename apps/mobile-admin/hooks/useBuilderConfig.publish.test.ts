// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { invalidateStoreReadiness } from '@/lib/invalidate-store-readiness';
import { useBuilderConfig } from './useBuilderConfig';
import {
  baseConfig,
  createBuilderConfigWrapper,
} from './useBuilderConfig.test-utils';

const merchantMocks = vi.hoisted(() => ({
  merchant: { id: 'merchant-1' } as { id: string } | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    session: { access_token: 'token-1' },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: merchantMocks.merchant }),
}));

vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'token-1' } },
      }),
    },
  },
}));

vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api-client')>(
      '@/lib/api-client'
    );
  return { ...actual, apiClient: vi.fn() };
});

const mockApiClient = vi.mocked(apiClient);
const mockInvalidateStoreReadiness = vi.mocked(invalidateStoreReadiness);

function setDefaultResponses() {
  mockApiClient.mockResolvedValue({ config: baseConfig, isPublished: false });
  mockInvalidateStoreReadiness.mockResolvedValue(undefined);
  merchantMocks.merchant = { id: 'merchant-1' };
}

describe('useBuilderConfig publishing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultResponses();
  });

  it('does not refresh readiness when saving or applying a draft edit', async () => {
    mockApiClient
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        config: { ...baseConfig, root: { title: 'AI draft' } },
      });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.saveDraft());
    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder', {
        method: 'POST',
        body: JSON.stringify({
          slug: 'home',
          merchantId: 'merchant-1',
          config: baseConfig,
          name: 'Home',
        }),
      });
    });

    await act(async () => {
      await result.current.sendMessage('Give the hero a brighter title');
    });

    expect(mockApiClient).toHaveBeenCalledWith('/api/builder/gemini', {
      method: 'POST',
      timeout: 30_000,
      body: JSON.stringify({
        merchantId: 'merchant-1',
        prompt: 'Give the hero a brighter title',
        currentConfig: {
          ...baseConfig,
          root: { title: 'AI draft' },
        },
      }),
    });
    expect(mockInvalidateStoreReadiness).not.toHaveBeenCalled();
  });

  it('keeps publish pending until builder and readiness invalidations finish', async () => {
    let releaseBuilder!: () => void;
    let releaseReadiness!: () => void;
    const builder = new Promise<void>((resolve) => {
      releaseBuilder = resolve;
    });
    const readiness = new Promise<void>((resolve) => {
      releaseReadiness = resolve;
    });
    mockInvalidateStoreReadiness.mockReturnValueOnce(readiness);
    mockApiClient
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    const { queryClient, Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(builder);
    act(() => result.current.publish());

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder', {
        method: 'PUT',
        body: JSON.stringify({ slug: 'home', merchantId: 'merchant-1' }),
      });
      expect(mockInvalidateStoreReadiness).toHaveBeenCalledWith(
        expect.anything(),
        'merchant-1'
      );
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['builderConfig', 'merchant-1', 'home'],
      });
      expect(result.current.isPublishing).toBe(true);
    });

    releaseBuilder();
    releaseReadiness();
    await waitFor(() => expect(result.current.isPublishing).toBe(false));
  });

  it('does not refresh readiness when publishing fails before request success', async () => {
    mockApiClient
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockRejectedValueOnce(new Error('Publish failed'));
    const { Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.publish());
    await waitFor(() => {
      expect(result.current.publishError).toEqual(new Error('Publish failed'));
    });
    expect(mockInvalidateStoreReadiness).not.toHaveBeenCalled();
  });

  it('keeps a successful publish successful when readiness refresh fails', async () => {
    mockApiClient
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockInvalidateStoreReadiness.mockRejectedValueOnce(
      new Error('Readiness refresh failed')
    );
    const { Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.publish());
    await waitFor(() => {
      expect(result.current.isPublishing).toBe(false);
      expect(result.current.publishError).toBeNull();
    });
  });

  it('fails before saving or publishing without merchant context', async () => {
    merchantMocks.merchant = null;
    const { Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    act(() => result.current.publish());
    await waitFor(() => {
      expect(result.current.publishError).toEqual(
        new Error('Merchant not loaded. Please try again.')
      );
    });
    expect(mockApiClient).not.toHaveBeenCalled();
    expect(mockInvalidateStoreReadiness).not.toHaveBeenCalled();
  });

  it('refreshes the merchant that started publishing after active merchant changes', async () => {
    let releasePublish!: () => void;
    const publishRequest = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-1') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (options?.method === 'PUT') return publishRequest;
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.publish());
    await waitFor(() => expect(result.current.isPublishing).toBe(true));
    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();
    releasePublish();

    await waitFor(() => {
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder', {
        method: 'PUT',
        body: JSON.stringify({ slug: 'home', merchantId: 'merchant-1' }),
      });
      expect(mockInvalidateStoreReadiness).toHaveBeenCalledWith(
        expect.anything(),
        'merchant-1'
      );
      expect(result.current.isPublishing).toBe(false);
    });
    expect(mockInvalidateStoreReadiness).not.toHaveBeenCalledWith(
      expect.anything(),
      'merchant-2'
    );
  });
});
