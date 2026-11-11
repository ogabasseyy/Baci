// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPost, apiPut } from '@/lib/api-client';
import type { BuilderToast } from './builder-client-types';
import { useBuilderMutationActions } from './use-builder-mutation-actions';

vi.mock('@/lib/api-client', () => ({ apiPost: vi.fn(), apiPut: vi.fn() }));

const mockApiPost = vi.mocked(apiPost);
const mockApiPut = vi.mocked(apiPut);

describe('useBuilderMutationActions', () => {
  beforeEach(() => {
    mockApiPost.mockReset();
    mockApiPut.mockReset();
  });

  it('rejects a save attempt during a publish PUT and settles both loading states', async () => {
    let resolvePublish!: (value: { lastUpdated: string }) => void;
    mockApiPost.mockResolvedValue({ lastUpdated: 'saved-at' });
    mockApiPut.mockReturnValue(
      new Promise((resolve) => {
        resolvePublish = resolve;
      })
    );
    const setLastUpdated = vi.fn();
    const setPublishing = vi.fn();
    const setSaving = vi.fn();
    const toast = vi.fn() as unknown as BuilderToast;
    const { result } = renderHook(() =>
      useBuilderMutationActions({
        canEdit: true,
        data: { content: [], root: {}, zones: {} } as never,
        degradedReason: null,
        expectedLastUpdated: 'old-at',
        merchantId: 'merchant-a',
        previewMode: null,
        seoData: {} as never,
        setLastUpdated,
        setPublishing,
        setSaving,
        setupSettings: {} as never,
        storeSettings: {} as never,
        toast,
      })
    );

    let publish!: Promise<void>;
    act(() => {
      publish = result.current.handlePublish();
    });
    await waitFor(() => expect(mockApiPut).toHaveBeenCalledTimes(1));
    await expect(
      result.current.handleSave({ content: [], root: {}, zones: {} } as never)
    ).resolves.toBeNull();
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    resolvePublish({ lastUpdated: 'published-at' });
    await publish;
    expect(setLastUpdated).toHaveBeenCalledWith('published-at');
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Published! 🚀' })
    );
    expect(setSaving).toHaveBeenLastCalledWith(false);
    expect(setPublishing).toHaveBeenLastCalledWith(false);
  });

  it('ignores an old merchant save after the merchant changes and allows the new merchant save', async () => {
    let resolveOldMerchantSave!: (value: { lastUpdated: string }) => void;
    mockApiPost
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldMerchantSave = resolve;
        })
      )
      .mockResolvedValueOnce({ lastUpdated: 'merchant-b-at' });
    const setLastUpdated = vi.fn();
    const setPublishing = vi.fn();
    const setSaving = vi.fn();
    const toast = vi.fn() as unknown as BuilderToast;
    let merchantId = 'merchant-a';
    const builderData = { content: [], root: {}, zones: {} } as never;
    const { rerender, result } = renderHook(() =>
      useBuilderMutationActions({
        canEdit: true,
        data: builderData,
        degradedReason: null,
        expectedLastUpdated: 'old-at',
        merchantId,
        previewMode: null,
        seoData: {} as never,
        setLastUpdated,
        setPublishing,
        setSaving,
        setupSettings: {} as never,
        storeSettings: {} as never,
        toast,
      })
    );

    let oldMerchantSave!: Promise<string | null>;
    act(() => {
      oldMerchantSave = result.current.handleSave(builderData);
    });
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1));

    merchantId = 'merchant-b';
    rerender();
    await expect(result.current.handleSave(builderData)).resolves.toBe(
      'merchant-b-at'
    );
    expect(setLastUpdated).toHaveBeenCalledWith('merchant-b-at');

    resolveOldMerchantSave({ lastUpdated: 'merchant-a-at' });
    await expect(oldMerchantSave).resolves.toBeNull();
    expect(setLastUpdated).not.toHaveBeenCalledWith('merchant-a-at');
    expect(setSaving).toHaveBeenLastCalledWith(false);
    expect(setPublishing).toHaveBeenLastCalledWith(false);
  });
});
