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

describe('useBuilderConfig merchant-scoped pending state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantMocks.merchant = { id: 'merchant-1' };
  });

  it('does not keep merchant B save pending while merchant A save is in flight', async () => {
    let resolveSave!: () => void;
    const merchantASave = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
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
    await waitFor(() => expect(result.current.isSavingDraft).toBe(true));

    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();

    await waitFor(() => {
      expect(result.current.config).toEqual(merchantBConfig);
      expect(result.current.isSavingDraft).toBe(false);
    });

    await act(async () => resolveSave());
  });

  it('does not keep merchant B publish pending while merchant A publish is in flight', async () => {
    let resolvePublish!: () => void;
    const merchantAPublish = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
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
      if (url === '/api/builder' && options?.method === 'PUT') {
        return merchantAPublish;
      }
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

    await waitFor(() => {
      expect(result.current.config).toEqual(merchantBConfig);
      expect(result.current.isPublishing).toBe(false);
    });

    await act(async () => resolvePublish());
  });
});
