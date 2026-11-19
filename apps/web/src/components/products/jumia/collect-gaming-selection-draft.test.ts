import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { collectGamingSelectionDraft } from './collect-gaming-selection-draft';
import { eligiblePreviewRequest } from './eligible-preview-request';

vi.mock('./eligible-preview-request', () => ({
  eligiblePreviewRequest: { page: vi.fn() },
}));
const category = '00000000-0000-4000-8000-000000000010';
const selectionId = '00000000-0000-4000-8000-000000000020';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
function page(number = 1): JumiaProductExportEligiblePage {
  return {
    selectionId,
    sourceCategoryId: category,
    total: 2,
    page: number,
    totalPages: 2,
    limit: 1,
    legacyUnmappedCount: 0,
    products: [
      {
        id: number === 1 ? firstId : secondId,
        ordinal: number,
        available: true,
        unavailableReason: null,
        capturedSourceVersion: 'a'.repeat(64),
        currentSourceVersion: 'a'.repeat(64),
        product: null,
      },
    ],
  };
}

describe('collectGamingSelectionDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eligiblePreviewRequest.page).mockImplementation(
      async (_merchant, _selection, number) => page(number)
    );
  });

  it('collects exact IDs and canonical versions from all pages before returning', async () => {
    const progress = vi.fn();
    const signal = new AbortController().signal;
    expect(
      await collectGamingSelectionDraft('merchant-1', page(2), signal, progress)
    ).toEqual({
      products: [
        {
          id: firstId,
          sourceCategoryId: category,
          capturedSourceVersion: 'a'.repeat(64),
        },
        {
          id: secondId,
          sourceCategoryId: category,
          capturedSourceVersion: 'a'.repeat(64),
        },
      ],
      ineligibleIds: [],
    });
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it.each([
    'unavailable',
    'changed',
  ])('excludes %s rows without inventing membership', async (state) => {
    vi.mocked(eligiblePreviewRequest.page).mockImplementation(
      async (_merchant, _selection, number) => {
        const result = page(number);
        if (number === 2)
          result.products[0] = {
            ...result.products[0],
            available: state !== 'unavailable',
            currentSourceVersion: state === 'changed' ? 'b'.repeat(64) : null,
          };
        return result;
      }
    );
    const result = await collectGamingSelectionDraft(
      'merchant-1',
      page(),
      new AbortController().signal
    );
    expect(result.products).toHaveLength(1);
    expect(result.ineligibleIds).toEqual([secondId]);
  });

  it.each([
    { selectionId: '00000000-0000-4000-8000-000000000021' },
    { sourceCategoryId: '00000000-0000-4000-8000-000000000011' },
    { total: 3 },
    { totalPages: 3 },
    { page: 1 },
    { products: [{ ...page(2).products[0], id: firstId }] },
    { products: [{ ...page(2).products[0], id: 'invalid' }] },
    {
      products: [{ ...page(2).products[0], capturedSourceVersion: 'invalid' }],
    },
    { products: [] },
  ])('rejects inconsistent, duplicate, or malformed later membership: %j', async (override) => {
    vi.mocked(eligiblePreviewRequest.page)
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce({ ...page(2), ...override });
    await expect(
      collectGamingSelectionDraft(
        'merchant-1',
        page(),
        new AbortController().signal
      )
    ).rejects.toThrow();
  });

  it('does not start reads for unbounded pagination metadata', async () => {
    await expect(
      collectGamingSelectionDraft(
        'merchant-1',
        { ...page(), totalPages: 100_001 },
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(eligiblePreviewRequest.page).not.toHaveBeenCalled();
  });

  it('rejects replaced captured membership on the initially visible page', async () => {
    vi.mocked(eligiblePreviewRequest.page).mockResolvedValueOnce({
      ...page(),
      products: [
        { ...page().products[0], id: '00000000-0000-4000-8000-000000000003' },
      ],
    });
    await expect(
      collectGamingSelectionDraft(
        'merchant-1',
        page(),
        new AbortController().signal
      )
    ).rejects.toThrow();
  });

  it('rejects a failed later page rather than returning a partial selection', async () => {
    vi.mocked(eligiblePreviewRequest.page)
      .mockResolvedValueOnce(page())
      .mockRejectedValueOnce(new Error('offline'));
    await expect(
      collectGamingSelectionDraft(
        'merchant-1',
        page(),
        new AbortController().signal
      )
    ).rejects.toThrow('offline');
  });

  it('rejects an aborted read even if its transport returns a late valid page', async () => {
    const controller = new AbortController();
    vi.mocked(eligiblePreviewRequest.page).mockImplementation(async () => {
      controller.abort();
      return page();
    });
    await expect(
      collectGamingSelectionDraft('merchant-1', page(), controller.signal)
    ).rejects.toThrow();
    expect(eligiblePreviewRequest.page).toHaveBeenCalledOnce();
  });
});
