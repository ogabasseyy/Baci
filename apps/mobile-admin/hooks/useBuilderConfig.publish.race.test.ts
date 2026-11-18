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

describe('useBuilderConfig deferred save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantMocks.merchant = { id: 'merchant-1' };
  });

  it('keeps merchant B local draft when a deferred merchant A save completes', async () => {
    let resolveMerchantASave!: () => void;
    const merchantASave = new Promise<void>((resolve) => {
      resolveMerchantASave = resolve;
    });
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    const merchantBDraft = {
      ...baseConfig,
      root: { title: 'Merchant B AI draft' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-1') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-2') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body)) as { merchantId: string };
        return body.merchantId === 'merchant-1'
          ? merchantASave
          : Promise.resolve(undefined);
      }
      if (url === '/api/builder/gemini' && options?.method === 'POST') {
        return Promise.resolve({ config: merchantBDraft });
      }
      return Promise.resolve(undefined);
    });
    const { queryClient, Wrapper } = createBuilderConfigWrapper();
    vi.spyOn(queryClient, 'invalidateQueries');
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.saveDraft());
    await waitFor(() =>
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder', {
        method: 'POST',
        body: JSON.stringify({
          slug: 'home',
          merchantId: 'merchant-1',
          config: baseConfig,
          name: 'Home',
        }),
      })
    );

    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));
    await act(async () => {
      await result.current.sendMessage('Make merchant B premium');
    });
    expect(result.current.config).toEqual(merchantBDraft);

    resolveMerchantASave();
    await waitFor(() =>
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['builderConfig', 'merchant-1', 'home'],
      })
    );
    expect(result.current.config).toEqual(merchantBDraft);
  });

  it('does not invoke a merchant A publish success callback after switching to B', async () => {
    let resolvePublish!: () => void;
    const publishRequest = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    const onSuccess = vi.fn();
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-1') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-2') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder' && options?.method === 'POST') {
        return Promise.resolve(undefined);
      }
      if (url === '/api/builder' && options?.method === 'PUT') {
        return publishRequest;
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.publish(undefined, { onSuccess }));
    await waitFor(() =>
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder', {
        body: JSON.stringify({ slug: 'home', merchantId: 'merchant-1' }),
        method: 'PUT',
      })
    );

    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));

    await act(async () => resolvePublish());

    await waitFor(() => expect(result.current.isPublishing).toBe(false));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('does not invoke a merchant A save error callback after switching to B', async () => {
    let rejectSave!: (error: Error) => void;
    const saveRequest = new Promise<void>((_resolve, reject) => {
      rejectSave = reject;
    });
    const onError = vi.fn();
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    mockApiClient.mockImplementation((url, options) => {
      if (url === '/api/builder?slug=home&merchantId=merchant-1') {
        return Promise.resolve({ config: baseConfig, isPublished: false });
      }
      if (url === '/api/builder?slug=home&merchantId=merchant-2') {
        return Promise.resolve({ config: merchantBConfig, isPublished: false });
      }
      if (url === '/api/builder' && options?.method === 'POST') {
        return saveRequest;
      }
      return Promise.resolve(undefined);
    });
    const { Wrapper } = createBuilderConfigWrapper();
    const { result, rerender } = renderHook(() => useBuilderConfig('home'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => result.current.saveDraft(undefined, { onError }));
    await waitFor(() =>
      expect(mockApiClient).toHaveBeenCalledWith('/api/builder', {
        body: JSON.stringify({
          slug: 'home',
          merchantId: 'merchant-1',
          config: baseConfig,
          name: 'Home',
        }),
        method: 'POST',
      })
    );

    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();
    await waitFor(() => expect(result.current.config).toEqual(merchantBConfig));

    await act(async () => rejectSave(new Error('Merchant A save failed')));

    await waitFor(() => expect(result.current.isSavingDraft).toBe(false));
    expect(onError).not.toHaveBeenCalled();
  });
});
