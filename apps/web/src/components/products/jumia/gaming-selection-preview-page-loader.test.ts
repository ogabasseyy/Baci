import { afterEach, describe, expect, it, vi } from 'vitest';
import { eligiblePreviewRequest } from './eligible-preview-request';
import { createGamingPreviewPageLoader } from './gaming-selection-preview-page-loader';

afterEach(() => vi.restoreAllMocks());

describe('Gaming preview page loader', () => {
  it('aborts before issuing an eligible-page request', async () => {
    const request = vi.spyOn(eligiblePreviewRequest, 'page');
    const controller = new AbortController();
    controller.abort(new Error('merchant changed'));
    const loadPage = createGamingPreviewPageLoader(
      vi.fn(() => true),
      vi.fn()
    );

    await expect(
      loadPage('merchant-a', 1, 'selection-a', 1, controller.signal)
    ).rejects.toThrow('merchant changed');
    expect(request).not.toHaveBeenCalled();
  });

  it('updates only the still-current merchant snapshot', async () => {
    const page = {
      selectionId: 'selection-a',
      total: 0,
      page: 1,
      totalPages: 0,
      legacyUnmappedCount: 0,
      products: [],
    };
    vi.spyOn(eligiblePreviewRequest, 'page').mockResolvedValue(page);
    const isCurrent = vi.fn(() => true);
    const setSnapshot = vi.fn();
    const loadPage = createGamingPreviewPageLoader(isCurrent, setSnapshot);

    await loadPage(
      'merchant-a',
      4,
      'selection-a',
      1,
      new AbortController().signal
    );

    expect(isCurrent).toHaveBeenCalledWith('merchant-a', 4);
    expect(setSnapshot).toHaveBeenCalledWith('merchant-a', 4, page);
  });

  it('rejects a response after merchant ownership changes', async () => {
    vi.spyOn(eligiblePreviewRequest, 'page').mockResolvedValue({
      selectionId: 'selection-a',
      total: 0,
      page: 1,
      totalPages: 0,
      legacyUnmappedCount: 0,
      products: [],
    });
    const setSnapshot = vi.fn();
    const loadPage = createGamingPreviewPageLoader(
      vi.fn(() => false),
      setSnapshot
    );

    await expect(
      loadPage('merchant-a', 4, 'selection-a', 1, new AbortController().signal)
    ).rejects.toThrow('Gaming preview merchant changed while loading.');
    expect(setSnapshot).not.toHaveBeenCalled();
  });
});
