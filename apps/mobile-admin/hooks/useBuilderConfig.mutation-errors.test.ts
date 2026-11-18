// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { useBuilderConfig } from './useBuilderConfig';
import {
  baseConfig,
  createBuilderConfigWrapper,
} from './useBuilderConfig.test-utils';

const merchantMocks = vi.hoisted(() => ({
  merchant: { id: 'merchant-a' } as { id: string } | null,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isLoading: false,
    session: { access_token: 'token-1' },
  }),
}));
vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: merchantMocks.merchant }),
}));
vi.mock('expo-constants', () => ({
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));
vi.mock('@/lib/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api-client')>(
      '@/lib/api-client'
    );
  return { ...actual, apiClient: vi.fn() };
});

const mockApiClient = vi.mocked(apiClient);

describe('useBuilderConfig mutation errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantMocks.merchant = { id: 'merchant-a' };
  });

  it('clears a failed merchant A draft-save error before rendering merchant B', async () => {
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-a') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-b') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder' && options?.method === 'POST') {
        return Promise.reject(new Error('Merchant A save failed'));
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    await act(async () => {
      try {
        await result.current.saveDraft();
      } catch {
        // The hook intentionally exposes the mutation failure as state.
      }
    });
    await waitFor(() =>
      expect(result.current.saveDraftError).toEqual(
        expect.objectContaining({ message: 'Merchant A save failed' })
      )
    );

    merchantMocks.merchant = { id: 'merchant-b' };
    rerender();

    expect(result.current.saveDraftError).toBeNull();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));
  });

  it('does not surface a merchant A save failure after switching to merchant B', async () => {
    let rejectMerchantASave!: (error: Error) => void;
    const merchantASave = new Promise<void>((_resolve, reject) => {
      rejectMerchantASave = reject;
    });
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-a') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-b') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder' && options?.method === 'POST') {
        return merchantASave;
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.saveDraft());
    await waitFor(() =>
      expect(mockApiClient).toHaveBeenCalledWith(
        '/api/builder',
        expect.objectContaining({ method: 'POST' })
      )
    );

    merchantMocks.merchant = { id: 'merchant-b' };
    rerender();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));

    await act(async () => rejectMerchantASave(new Error('Merchant A failed')));

    expect(result.current.saveDraftError).toBeNull();
  });

  it('clears an AI editing error when the selected merchant changes', async () => {
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-a') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-b') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder/gemini' && options?.method === 'POST') {
        return Promise.reject(new Error('Merchant A AI failed'));
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    await act(async () => {
      try {
        await result.current.sendMessage('Make it blue');
      } catch {
        // The hook retains the formatted mutation error for merchant A.
      }
    });
    await waitFor(() => expect(result.current.aiError).not.toBeNull());

    merchantMocks.merchant = { id: 'merchant-b' };
    rerender();

    expect(result.current.aiError).toBeNull();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));
  });

  it('clears a publish error when the selected merchant changes', async () => {
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-a') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-b') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder' && options?.method === 'POST') {
        return Promise.resolve(undefined);
      }
      if (url === '/api/builder' && options?.method === 'PUT') {
        return Promise.reject(new Error('Merchant A publish failed'));
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.publish());
    await waitFor(() => expect(result.current.publishError).not.toBeNull());

    merchantMocks.merchant = { id: 'merchant-b' };
    rerender();

    expect(result.current.publishError).toBeNull();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));
  });
});
