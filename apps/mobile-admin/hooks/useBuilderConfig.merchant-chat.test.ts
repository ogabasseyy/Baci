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
  return { ...actual, apiClient: vi.fn() };
});

const mockApiClient = vi.mocked(apiClient);

describe('useBuilderConfig merchant chat scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantMocks.merchant = { id: 'merchant-1' };
  });

  it('never renders merchant A chat messages in a merchant B frame', async () => {
    let resolveAiRequest!: (value: { config: typeof baseConfig }) => void;
    const merchantBConfig = {
      ...baseConfig,
      root: { title: 'Merchant B' },
    };
    const aiResponse = new Promise<{ config: typeof baseConfig }>((resolve) => {
      resolveAiRequest = resolve;
    });
    const renderedMessages: Array<{
      merchantId: string | null;
      messages: Array<{ content: string; role: string }>;
    }> = [];
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
    const { result, rerender } = renderHook(
      () => {
        const builder = useBuilderConfig('home');
        renderedMessages.push({
          merchantId: merchantMocks.merchant?.id ?? null,
          messages: builder.messages.map(({ content, role }) => ({
            content,
            role,
          })),
        });
        return builder;
      },
      { wrapper: Wrapper }
    );

    await waitFor(() => expect(result.current.config).toEqual(baseConfig));
    act(() => {
      void result.current.sendMessage('Make merchant A premium');
    });
    await waitFor(() =>
      expect(result.current.messages).toEqual([
        expect.objectContaining({
          content: 'Make merchant A premium',
          role: 'user',
        }),
      ])
    );

    const framesBeforeMerchantSwitch = renderedMessages.length;
    merchantMocks.merchant = { id: 'merchant-2' };
    rerender();

    const merchantBFrames = renderedMessages
      .slice(framesBeforeMerchantSwitch)
      .filter((frame) => frame.merchantId === 'merchant-2');
    expect(merchantBFrames).not.toHaveLength(0);
    expect(merchantBFrames.every((frame) => frame.messages.length === 0)).toBe(
      true
    );

    await act(async () => {
      resolveAiRequest({ config: baseConfig });
    });
  });
});
