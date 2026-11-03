import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const merchantState = vi.hoisted(() => ({
  current: { id: 'merchant-1' } as { id: string } | null,
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: vi.fn(() => ({ merchant: merchantState.current })),
}));

const mockToast = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

import { useIntegrationSettings } from './use-integration-settings';

describe('useIntegrationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    merchantState.current = { id: 'merchant-1' };
  });

  it('fetches settings on mount when merchant is available', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ facebook_pixel_id: 'px-123' }),
    } as Response);

    const { result } = renderHook(() =>
      useIntegrationSettings<{ facebook_pixel_id: string | null }>({
        keys: ['facebook_pixel_id'],
        platformName: 'Facebook',
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/merchant/features?merchantId=merchant-1'
    );
    expect(result.current.settings?.facebook_pixel_id).toBe('px-123');
  });

  it('handles fetch failure gracefully', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() =>
      useIntegrationSettings<{ pixel_id: string | null }>({
        keys: ['pixel_id'],
        platformName: 'Test',
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.settings).toBeNull();
  });

  it('reports hasMerchant as true when merchant exists', () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response);

    const { result } = renderHook(() =>
      useIntegrationSettings({ keys: [], platformName: 'Test' })
    );
    expect(result.current.hasMerchant).toBe(true);
  });

  it('saves settings with the CSRF-aware fetch wrapper', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ facebook_pixel_id: 'old-px' }),
    } as Response);
    mockFetchWithCsrf.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ facebook_pixel_id: 'new-px' }),
    } as Response);
    const keys: (keyof { facebook_pixel_id: string | null })[] = [
      'facebook_pixel_id',
    ];

    const { result } = renderHook(() =>
      useIntegrationSettings<{ facebook_pixel_id: string | null }>({
        keys,
        platformName: 'Facebook',
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await act(async () => {
      await result.current.saveSettings({ facebook_pixel_id: 'new-px' });
    });

    expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/merchant/features', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facebook_pixel_id: 'new-px',
        merchantId: 'merchant-1',
      }),
    });
    await waitFor(() => {
      expect(result.current.settings?.facebook_pixel_id).toBe('new-px');
    });
  });

  it('shows the error toast and rethrows when saving settings fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ facebook_pixel_id: 'old-px' }),
    } as Response);
    mockFetchWithCsrf.mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    const keys: (keyof { facebook_pixel_id: string | null })[] = [
      'facebook_pixel_id',
    ];

    const { result } = renderHook(() =>
      useIntegrationSettings<{ facebook_pixel_id: string | null }>({
        keys,
        platformName: 'Facebook',
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await expect(
      act(async () => {
        await result.current.saveSettings({ facebook_pixel_id: 'new-px' });
      })
    ).rejects.toThrow('Failed to save settings');
    expect(mockFetchWithCsrf).toHaveBeenCalledWith('/api/merchant/features', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facebook_pixel_id: 'new-px',
        merchantId: 'merchant-1',
      }),
    });
    expect(mockToast).toHaveBeenCalledWith({
      variant: 'destructive',
      title: 'Save failed',
      description: 'Could not save your settings. Please try again.',
    });
  });

  it('ignores a stale save completion after the merchant changes', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ facebook_pixel_id: 'current-px' }),
    } as Response);
    const saveResponse = deferred<Response>();
    mockFetchWithCsrf.mockReturnValueOnce(saveResponse.promise);
    const keys: (keyof { facebook_pixel_id: string | null })[] = [
      'facebook_pixel_id',
    ];
    const { result, rerender } = renderHook(() =>
      useIntegrationSettings<{ facebook_pixel_id: string | null }>({
        keys,
        platformName: 'Facebook',
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let savePromise: Promise<void>;
    act(() => {
      savePromise = result.current.saveSettings({ facebook_pixel_id: 'a-px' });
    });
    merchantState.current = { id: 'merchant-2' };
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      saveResponse.resolve({
        ok: true,
        json: () => Promise.resolve({ facebook_pixel_id: 'stale-a-px' }),
      } as Response);
      await savePromise;
    });

    expect(result.current.settings?.facebook_pixel_id).toBe('current-px');
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('ignores merchant A save completion after switching A to B and back to A', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ facebook_pixel_id: 'loaded-px' }),
    } as Response);
    const saveResponse = deferred<Response>();
    mockFetchWithCsrf.mockReturnValueOnce(saveResponse.promise);
    const keys: (keyof { facebook_pixel_id: string | null })[] = [
      'facebook_pixel_id',
    ];
    const { result, rerender } = renderHook(() =>
      useIntegrationSettings<{ facebook_pixel_id: string | null }>({
        keys,
        platformName: 'Facebook',
      })
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let savePromise: Promise<void>;
    act(() => {
      savePromise = result.current.saveSettings({ facebook_pixel_id: 'a-px' });
    });
    merchantState.current = { id: 'merchant-2' };
    rerender();
    merchantState.current = { id: 'merchant-1' };
    rerender();
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      saveResponse.resolve({
        ok: true,
        json: () => Promise.resolve({ facebook_pixel_id: 'stale-a-px' }),
      } as Response);
      await savePromise;
    });

    expect(result.current.settings?.facebook_pixel_id).toBe('loaded-px');
    expect(mockToast).not.toHaveBeenCalled();
  });
});

it('declares the integration hook as a client entrypoint before imports', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/hooks/use-integration-settings.ts'),
    'utf8'
  );
  expect(source.trimStart()).toMatch(/^'use client';/);
});
