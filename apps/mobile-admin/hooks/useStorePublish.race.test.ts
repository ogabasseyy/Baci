// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  createElement,
  type ReactNode,
  Suspense,
  startTransition,
  useState,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorePublish } from './useStorePublish';

const { mockApiClient } = vi.hoisted(() => ({
  mockApiClient: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => mockApiClient(...args),
  NetworkError: class NetworkError extends Error {},
}));

vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  }

  return Wrapper;
}

describe('useStorePublish merchant switching', () => {
  beforeEach(() => {
    mockApiClient.mockReset();
  });

  it('does not complete a merchant A publish in merchant B UI', async () => {
    let resolvePublish!: () => void;
    const publishRequest = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    const onPublished = vi.fn().mockResolvedValue(undefined);
    mockApiClient.mockReturnValueOnce(publishRequest);

    const { result, rerender } = renderHook(
      ({ merchantId }) => useStorePublish({ merchantId, onPublished }),
      {
        initialProps: { merchantId: 'merchant-a' },
        wrapper: createWrapper(),
      }
    );

    let publish!: ReturnType<typeof result.current.publishStore>;
    act(() => {
      publish = result.current.publishStore();
    });
    await waitFor(() => expect(result.current.isPublishing).toBe(true));

    rerender({ merchantId: 'merchant-b' });
    expect(result.current.isPublishing).toBe(false);

    let publishResult:
      | Awaited<ReturnType<typeof result.current.publishStore>>
      | undefined;
    await act(async () => {
      resolvePublish();
      publishResult = await publish;
    });

    expect(publishResult).toEqual({ status: 'stale' });
    expect(onPublished).not.toHaveBeenCalled();
    expect(result.current.isPublishing).toBe(false);
  });

  it('records a failed stale publish without exposing its error in merchant B UI', async () => {
    const logError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let rejectPublish!: (error: Error) => void;
    const publishRequest = new Promise<void>((_resolve, reject) => {
      rejectPublish = reject;
    });
    mockApiClient.mockReturnValueOnce(publishRequest);

    const { result, rerender } = renderHook(
      ({ merchantId }) => useStorePublish({ merchantId }),
      {
        initialProps: { merchantId: 'merchant-a' },
        wrapper: createWrapper(),
      }
    );

    let publish!: ReturnType<typeof result.current.publishStore>;
    act(() => {
      publish = result.current.publishStore();
    });
    await waitFor(() => expect(result.current.isPublishing).toBe(true));
    rerender({ merchantId: 'merchant-b' });

    await expect(
      act(async () => {
        rejectPublish(new Error('merchant A publish failed'));
        return publish;
      })
    ).resolves.toEqual({ status: 'stale' });

    expect(logError).toHaveBeenCalledWith(
      '[StorePublish] Stale publish failed',
      expect.any(Error)
    );
    expect(result.current.isPublishing).toBe(false);
  });

  it('does not complete an old A publish after an A-to-B-to-A switch', async () => {
    let resolvePublish!: () => void;
    const publishRequest = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    const onPublished = vi.fn().mockResolvedValue(undefined);
    mockApiClient.mockReturnValueOnce(publishRequest);

    const { result, rerender } = renderHook(
      ({ merchantId }) => useStorePublish({ merchantId, onPublished }),
      {
        initialProps: { merchantId: 'merchant-a' },
        wrapper: createWrapper(),
      }
    );

    let publish!: ReturnType<typeof result.current.publishStore>;
    act(() => {
      publish = result.current.publishStore();
    });
    rerender({ merchantId: 'merchant-b' });
    rerender({ merchantId: 'merchant-a' });

    await act(async () => {
      resolvePublish();
      await expect(publish).resolves.toEqual({ status: 'stale' });
    });

    expect(onPublished).not.toHaveBeenCalled();
    expect(result.current.isPublishing).toBe(false);
  });

  it('keeps merchant A active when a merchant B render is abandoned', async () => {
    let resolvePublish!: () => void;
    const publishRequest = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    const onPublished = vi.fn().mockResolvedValue(undefined);
    const suspendedMerchantRender = new Promise<never>(() => undefined);
    mockApiClient.mockReturnValueOnce(publishRequest);

    function PublishControls({
      merchantId,
      suspend,
    }: {
      merchantId: string;
      suspend: boolean;
    }) {
      const { publishStore } = useStorePublish({ merchantId, onPublished });
      if (suspend) throw suspendedMerchantRender;
      return createElement(
        'button',
        { onClick: () => void publishStore(), type: 'button' },
        `Publish ${merchantId}`
      );
    }

    function Scenario() {
      const [merchantId, setMerchantId] = useState('merchant-a');
      return createElement(
        'div',
        undefined,
        createElement(
          'button',
          {
            onClick: () => {
              startTransition(() => setMerchantId('merchant-b'));
            },
            type: 'button',
          },
          'Switch merchant'
        ),
        createElement(
          Suspense,
          { fallback: createElement('span', undefined, 'Loading merchant B') },
          createElement(PublishControls, {
            merchantId,
            suspend: merchantId === 'merchant-b',
          })
        )
      );
    }

    render(createElement(Scenario), { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'Publish merchant-a' }));
    await waitFor(() => expect(mockApiClient).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Switch merchant' }));
    expect(
      screen.getByRole('button', { name: 'Publish merchant-a' })
    ).toBeTruthy();

    await act(async () => {
      resolvePublish();
    });

    expect(onPublished).toHaveBeenCalledOnce();
  });

  it('rejects an overlapping publish for the same merchant without clearing the first publish', async () => {
    let resolvePublish!: () => void;
    const publishRequest = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    const onPublished = vi.fn().mockResolvedValue(undefined);
    mockApiClient.mockReturnValue(publishRequest);

    const { result } = renderHook(
      () => useStorePublish({ merchantId: 'merchant-a', onPublished }),
      { wrapper: createWrapper() }
    );

    let firstPublish!: ReturnType<typeof result.current.publishStore>;
    let secondPublish!: ReturnType<typeof result.current.publishStore>;
    act(() => {
      firstPublish = result.current.publishStore();
      secondPublish = result.current.publishStore();
    });
    const secondOutcome = secondPublish.then(
      () => ({ status: 'resolved' as const }),
      (error: unknown) => ({ status: 'rejected' as const, error })
    );

    expect(result.current.isPublishing).toBe(true);

    await act(async () => {
      resolvePublish();
      await expect(firstPublish).resolves.toEqual({ status: 'published' });
    });

    const secondResult = await secondOutcome;
    const publishRequestCount = mockApiClient.mock.calls.length;
    expect(publishRequestCount).toBe(1);
    expect(secondResult).toMatchObject({
      status: 'rejected',
      error: expect.objectContaining({
        message: 'A publish is already in progress.',
      }),
    });
    expect(onPublished).toHaveBeenCalledOnce();
    expect(result.current.isPublishing).toBe(false);
  });
});
