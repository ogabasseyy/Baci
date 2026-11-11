// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, NetworkError } from '@/lib/api-client';
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

vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: merchantMocks.merchant }),
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
  return {
    ...actual,
    apiClient: vi.fn(),
  };
});

const mockApiClient = vi.mocked(apiClient);
describe('useBuilderConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantMocks.merchant = { id: 'merchant-1' };
    mockApiClient.mockResolvedValue({
      config: baseConfig,
      isPublished: false,
    });
  });

  it('loads builder config through the centralized mobile API client', async () => {
    const { queryClient, Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.config).toEqual(baseConfig);
    });

    expect(mockApiClient).toHaveBeenCalledWith(
      '/api/builder?slug=home&merchantId=merchant-1'
    );
    expect(
      queryClient.getQueryData(['builderConfig', 'merchant-1', 'home'])
    ).toEqual({ config: baseConfig, isPublished: false });
  });

  it('keeps the current draft and shows fallback copy when AI editing is unavailable', async () => {
    mockApiClient
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockRejectedValueOnce(
        new NetworkError('AI editor is temporarily unavailable', {
          statusCode: 503,
          data: {
            code: 'ai_provider_unavailable',
            requestId: 'req-123',
          },
        })
      );

    const { Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.config).toEqual(baseConfig);
    });

    let thrown: unknown;
    await act(async () => {
      try {
        await result.current.sendMessage('Make it blue and green');
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      'AI editor is temporarily unavailable. Your current draft is saved; please try again later.'
    );
    expect(thrown).toEqual(
      expect.objectContaining({
        code: 'ai_provider_unavailable',
        requestId: 'req-123',
      })
    );
    expect(result.current.config).toEqual(baseConfig);
    expect(result.current.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'Make it blue and green',
      }),
      expect.objectContaining({
        role: 'system',
        content:
          'AI editor is temporarily unavailable. Your current draft is saved; please try again later.',
      }),
    ]);
    expect(mockApiClient).toHaveBeenLastCalledWith('/api/builder/gemini', {
      method: 'POST',
      timeout: 30_000,
      body: JSON.stringify({
        merchantId: 'merchant-1',
        prompt: 'Make it blue and green',
        currentConfig: baseConfig,
      }),
    });
  });

  it('does not apply an original merchant A AI draft after A to B to A switches', async () => {
    let resolveAiRequest!: (value: { config: typeof baseConfig }) => void;
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    const aiResponse = new Promise<{ config: typeof baseConfig }>((resolve) => {
      resolveAiRequest = resolve;
    });
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-1') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-2') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder/gemini' && options?.method === 'POST') {
        return aiResponse;
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => {
      result.current.sendMessage('Make merchant A premium');
    });
    await waitFor(() =>
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder/gemini', {
        method: 'POST',
        timeout: 30_000,
        body: JSON.stringify({
          merchantId: 'merchant-1',
          prompt: 'Make merchant A premium',
          currentConfig: baseConfig,
        }),
      })
    );

    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));
    expect(result.current.messages).toEqual([]);

    merchantMocks.merchant = { id: 'merchant-1' };
    rerender();
    await waitFor(() => expect(result.current.config).toEqual(baseConfig));

    await act(async () => {
      resolveAiRequest({
        config: {
          ...baseConfig,
          root: { title: 'Merchant A AI draft' },
        },
      });
    });

    expect(result.current.config).toEqual(baseConfig);
  });

  it('applies only the latest concurrent merchant AI response and keeps its loading state', async () => {
    let resolveFirst!: (value: { config: typeof baseConfig }) => void;
    let resolveSecond!: (value: { config: typeof baseConfig }) => void;
    const firstResponse = new Promise<{ config: typeof baseConfig }>(
      (resolve) => {
        resolveFirst = resolve;
      }
    );
    const secondResponse = new Promise<{ config: typeof baseConfig }>(
      (resolve) => {
        resolveSecond = resolve;
      }
    );
    mockApiClient
      .mockResolvedValueOnce({ config: baseConfig, isPublished: false })
      .mockReturnValueOnce(firstResponse)
      .mockReturnValueOnce(secondResponse);
    const { Wrapper } = createBuilderConfigWrapper();
    const { result } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => {
      result.current.sendMessage('First design');
      result.current.sendMessage('Second design');
    });
    await waitFor(() => expect(result.current.isProcessingAI).toBe(true));

    await act(async () => {
      resolveFirst({
        config: { ...baseConfig, root: { title: 'Older result' } },
      });
    });
    expect(result.current.config).toEqual(baseConfig);
    expect(result.current.isProcessingAI).toBe(true);

    await act(async () => {
      resolveSecond({
        config: { ...baseConfig, root: { title: 'Latest result' } },
      });
    });
    expect(result.current.config).toEqual({
      ...baseConfig,
      root: { title: 'Latest result' },
    });
    expect(result.current.isProcessingAI).toBe(false);
  });
});
