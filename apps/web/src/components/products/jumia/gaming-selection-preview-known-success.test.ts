import { afterEach, describe, expect, it, vi } from 'vitest';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import { recoverKnownSuccessfulPreview } from './gaming-selection-preview-known-success';

const merchantId = 'known-preview-recovery-test';
const proof = {
  cacheKey: gamingSelectionPreviewCache.key(merchantId, 'gaming'),
  selection: {
    selectionId: '00000000-0000-4000-8000-000000000092',
    expiresAt: '2099-01-01T00:00:00.000Z',
  },
};

afterEach(() => {
  gamingSelectionPreviewCache.clearKnownSuccessfulSelection(merchantId);
  vi.restoreAllMocks();
});

describe('recoverKnownSuccessfulPreview', () => {
  it('does not turn an arbitrary or missing cache entry into proof', async () => {
    const loadPage = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      recoverKnownSuccessfulPreview({
        loadPage,
        merchantId,
        generation: 1,
        setLoading,
        setError,
      })
    ).resolves.toBe('missing');

    expect(loadPage).not.toHaveBeenCalled();
    expect(setLoading).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it('holds the retry path on the exact acknowledged snapshot', async () => {
    gamingSelectionPreviewCache.rememberKnownSuccessfulSelection(
      merchantId,
      proof.cacheKey,
      proof.selection
    );
    const loadKnown = vi
      .spyOn(gamingSelectionPreviewCache, 'loadKnownSuccessfulSelection')
      .mockResolvedValue(true);
    const loadPage = vi.fn();
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      recoverKnownSuccessfulPreview({
        loadPage,
        merchantId,
        generation: 2,
        setLoading,
        setError,
      })
    ).resolves.toBe('loaded');

    expect(loadKnown).toHaveBeenCalledWith(merchantId, loadPage);
    expect(setLoading.mock.calls).toEqual([
      [merchantId, 2, true],
      [merchantId, 2, false],
    ]);
    expect(setError).toHaveBeenCalledWith(merchantId, 2, null);
  });

  it('retains proof after a transient page-read failure', async () => {
    gamingSelectionPreviewCache.rememberKnownSuccessfulSelection(
      merchantId,
      proof.cacheKey,
      proof.selection
    );
    vi.spyOn(
      gamingSelectionPreviewCache,
      'loadKnownSuccessfulSelection'
    ).mockRejectedValue(new Error('temporary network failure'));
    vi.spyOn(gamingSelectionPreviewCache, 'errorMessage').mockReturnValue(
      'Please retry loading the preview.'
    );
    const setLoading = vi.fn();
    const setError = vi.fn();

    await expect(
      recoverKnownSuccessfulPreview({
        loadPage: vi.fn(),
        merchantId,
        generation: 3,
        setLoading,
        setError,
      })
    ).resolves.toBe('failed');

    expect(
      gamingSelectionPreviewCache.findKnownSuccessfulSelection(merchantId)
    ).toEqual(proof);
    expect(setError).toHaveBeenLastCalledWith(
      merchantId,
      3,
      'Please retry loading the preview.'
    );
    expect(setLoading).toHaveBeenLastCalledWith(merchantId, 3, false);
  });
});
