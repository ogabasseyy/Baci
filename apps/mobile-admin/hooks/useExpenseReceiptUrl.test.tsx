import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExpenseReceiptUrl } from './useExpenseReceiptUrl';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';
const receiptPath = `${merchantId}/expenses/31bc282a-c36d-4bc8-815e-731ac75d1c01.jpg`;

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        createSignedUrl: (...args: unknown[]) => mocks.createSignedUrl(...args),
      }),
    },
  },
}));

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('useExpenseReceiptUrl', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/signed-receipt' },
      error: null,
    });
  });

  it('mints a five-minute signed URL for an owned private receipt and refreshes it before expiry', async () => {
    const queryClient = createQueryClient();
    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: receiptPath,
          legacyReceiptUrl: null,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() =>
      expect(result.current.url).toBe(
        'https://storage.example.com/signed-receipt'
      )
    );

    expect(mocks.createSignedUrl).toHaveBeenCalledWith(receiptPath, 300);
  });

  it('refreshes the signed URL when its query is invalidated', async () => {
    const queryClient = createQueryClient();
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.example.com/first' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.example.com/refreshed' },
        error: null,
      });

    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: receiptPath,
          legacyReceiptUrl: null,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => expect(result.current.url).toContain('/first'));
    await queryClient.invalidateQueries({
      queryKey: ['expense-receipt-url', merchantId, receiptPath],
    });

    await waitFor(() => expect(result.current.url).toContain('/refreshed'));
  });

  it('refreshes an active signed URL after four minutes, before its five-minute expiry', async () => {
    vi.useFakeTimers();
    const queryClient = createQueryClient();
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.example.com/first' },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.example.com/refreshed' },
        error: null,
      });

    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: receiptPath,
          legacyReceiptUrl: null,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(result.current.url).toContain('/first');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('fails without minting a URL when a private path belongs to another merchant', async () => {
    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: 'other-merchant/expenses/receipt.jpg',
          legacyReceiptUrl: 'https://legacy.example.com/receipt.jpg',
        }),
      { wrapper: createWrapper(createQueryClient()) }
    );

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

    expect(result.current.url).toBeNull();
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it('fails without minting a URL for a traversal-shaped private path', async () => {
    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: `${merchantId}/expenses/../31bc282a-c36d-4bc8-815e-731ac75d1c01.jpg`,
          legacyReceiptUrl: null,
        }),
      { wrapper: createWrapper(createQueryClient()) }
    );

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));

    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it('uses only a valid HTTPS legacy URL when no private storage path exists', () => {
    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: null,
          legacyReceiptUrl: 'https://legacy.example.com/receipt.jpg',
        }),
      { wrapper: createWrapper(createQueryClient()) }
    );

    expect(result.current).toMatchObject({
      error: null,
      isLoading: false,
      url: 'https://legacy.example.com/receipt.jpg',
    });
    expect(mocks.createSignedUrl).not.toHaveBeenCalled();
  });

  it('does not expose an unsafe legacy URL', () => {
    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: null,
          legacyReceiptUrl: 'javascript:alert(1)',
        }),
      { wrapper: createWrapper(createQueryClient()) }
    );

    expect(result.current).toMatchObject({
      error: null,
      isLoading: false,
      url: null,
    });
  });

  it('keeps a cached signed URL when a background refresh fails', async () => {
    const queryClient = createQueryClient();
    mocks.createSignedUrl
      .mockResolvedValueOnce({
        data: { signedUrl: 'https://storage.example.com/cached' },
        error: null,
      })
      .mockRejectedValueOnce(
        new Error('Failed to create a private receipt URL')
      );

    const { result } = renderHook(
      () =>
        useExpenseReceiptUrl({
          merchantId,
          receiptStoragePath: receiptPath,
          legacyReceiptUrl: null,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() =>
      expect(result.current.url).toBe('https://storage.example.com/cached')
    );

    await queryClient.invalidateQueries({
      queryKey: ['expense-receipt-url', merchantId, receiptPath],
    });

    await waitFor(() => expect(mocks.createSignedUrl).toHaveBeenCalledTimes(2));
    expect(result.current.url).toBe('https://storage.example.com/cached');
    expect(result.current.error).toBeNull();
  });
});
