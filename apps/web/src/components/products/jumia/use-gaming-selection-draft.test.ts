import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { JumiaProductExportEligiblePage } from '@/schemas/jumia/eligible-page';
import { useGamingSelectionDraft } from './use-gaming-selection-draft';

const id = '00000000-0000-4000-8000-000000000001';
const category = '00000000-0000-4000-8000-000000000010';
const snapshot: JumiaProductExportEligiblePage = {
  selectionId: '00000000-0000-4000-8000-000000000020',
  sourceCategoryId: category,
  page: 1,
  limit: 50,
  total: 1,
  totalPages: 1,
  legacyUnmappedCount: 0,
  products: [
    {
      id,
      ordinal: 1,
      available: true,
      unavailableReason: null,
      capturedSourceVersion: 'a'.repeat(64),
      currentSourceVersion: 'a'.repeat(64),
      product: null,
    },
  ],
};

describe('useGamingSelectionDraft evidence', () => {
  it('stores UUID/category/canonical captured digest and never toggles unknown IDs', () => {
    const { result } = renderHook(() =>
      useGamingSelectionDraft('merchant-1', snapshot)
    );
    act(() => result.current.toggle(id));
    expect(result.current.draft).toEqual({
      [id]: {
        id,
        sourceCategoryId: category,
        capturedSourceVersion: 'a'.repeat(64),
      },
    });
    act(() => result.current.toggle('fabricated-id'));
    expect(Object.keys(result.current.draft)).toEqual([id]);
  });

  it('keeps selected unavailable rows invalid when select-all observes them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...snapshot,
          products: [
            {
              ...snapshot.products[0],
              available: false,
              currentSourceVersion: null,
            },
          ],
        })
      )
    );
    const { result } = renderHook(() =>
      useGamingSelectionDraft('merchant-1', snapshot)
    );
    act(() => result.current.toggle(id));
    await act(async () => result.current.selectAll());
    expect(Object.keys(result.current.draft)).toEqual([id]);
    expect(result.current.invalidCount).toBe(1);
    act(() => result.current.clear());
    expect(result.current.invalidCount).toBe(0);
  });

  it('invalidates selected evidence if the same selection advertises another source category', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useGamingSelectionDraft('merchant-1', value),
      { initialProps: { value: snapshot } }
    );
    act(() => result.current.toggle(id));
    rerender({
      value: {
        ...snapshot,
        sourceCategoryId: '00000000-0000-4000-8000-000000000011',
      },
    });
    expect(result.current.invalidCount).toBe(1);
  });

  it('fences inconsistent frozen totals across page observations until a new selection', () => {
    const first = { ...snapshot, limit: 1 };
    const { result, rerender } = renderHook(
      ({ value }) => useGamingSelectionDraft('merchant-1', value),
      { initialProps: { value: first } }
    );
    act(() => result.current.toggle(id));
    rerender({ value: { ...first, total: 2, totalPages: 2 } });
    expect(result.current.evidenceValid).toBe(false);
    expect(result.current.eligible.size).toBe(0);
    expect(result.current.invalidCount).toBe(1);
  });

  it.each([
    'unavailable',
    'changed',
  ])('blocks never-selected %s observations until a new selection', async (state) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...snapshot,
          products: [
            {
              ...snapshot.products[0],
              available: state !== 'unavailable',
              currentSourceVersion:
                state === 'unavailable' ? null : 'b'.repeat(64),
            },
          ],
        })
      )
    );
    const { result } = renderHook(() =>
      useGamingSelectionDraft('merchant-1', snapshot)
    );
    await act(async () => result.current.selectAll());
    expect(result.current.eligible.has(id)).toBe(false);
    act(() => result.current.toggle(id));
    expect(result.current.invalidCount).toBe(0);
    expect(Object.keys(result.current.draft)).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(snapshot))
    );
    await act(async () => result.current.selectAll());
    expect(Object.keys(result.current.draft)).toEqual([]);
  });

  it('rejects bulk membership that omits a selection from a previously visited page', async () => {
    const second: JumiaProductExportEligiblePage = {
      ...snapshot,
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
      products: [
        {
          ...snapshot.products[0],
          id: '00000000-0000-4000-8000-000000000002',
          ordinal: 2,
        },
      ],
    };
    const first = { ...snapshot, limit: 1, total: 2, totalPages: 2 };
    const { result, rerender } = renderHook(
      ({ value }) => useGamingSelectionDraft('merchant-1', value),
      { initialProps: { value: second } }
    );
    act(() => result.current.toggle('00000000-0000-4000-8000-000000000002'));
    rerender({ value: first });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          url.includes('page=2')
            ? {
                ...second,
                products: [
                  {
                    ...second.products[0],
                    id: '00000000-0000-4000-8000-000000000003',
                  },
                ],
              }
            : first
        )
      )
    );
    await act(async () => result.current.selectAll());
    expect(Object.keys(result.current.draft)).toEqual([
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(result.current.invalidCount).toBe(1);
    expect(result.current.error).toMatch(/unchanged/i);
  });

  it('keeps invalid observations from validated pages even if a later bulk page fails', async () => {
    const first = { ...snapshot, limit: 1, total: 2, totalPages: 2 };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            ...first,
            products: [
              {
                ...first.products[0],
                available: false,
                currentSourceVersion: null,
              },
            ],
          })
        )
        .mockRejectedValueOnce(new Error('offline'))
    );
    const { result } = renderHook(() =>
      useGamingSelectionDraft('merchant-1', first)
    );
    act(() => result.current.toggle(id));
    await act(async () => result.current.selectAll());
    expect(Object.keys(result.current.draft)).toEqual([id]);
    expect(result.current.invalidCount).toBe(1);
    expect(result.current.error).toMatch(/unchanged/i);
  });

  it('invalidates an off-page changed captured digest before a later page fails', async () => {
    const first = { ...snapshot, limit: 1, total: 3, totalPages: 3 };
    const second: JumiaProductExportEligiblePage = {
      ...first,
      page: 2,
      products: [
        {
          ...snapshot.products[0],
          id: '00000000-0000-4000-8000-000000000002',
          ordinal: 2,
        },
      ],
    };
    const { result, rerender } = renderHook(
      ({ value }) => useGamingSelectionDraft('merchant-1', value),
      { initialProps: { value: second } }
    );
    act(() => result.current.toggle('00000000-0000-4000-8000-000000000002'));
    rerender({ value: first });
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(first))
        .mockResolvedValueOnce(
          Response.json({
            ...second,
            products: [
              {
                ...second.products[0],
                capturedSourceVersion: 'b'.repeat(64),
                currentSourceVersion: 'b'.repeat(64),
              },
            ],
          })
        )
        .mockRejectedValueOnce(new Error('offline'))
    );
    await act(async () => result.current.selectAll());
    expect(result.current.invalidCount).toBe(1);
    expect(Object.keys(result.current.draft)).toEqual([
      '00000000-0000-4000-8000-000000000002',
    ]);
    expect(result.current.error).toMatch(/unchanged/i);
  });

  it('retains a blocked observation through cancellation and clear without selecting partial membership', async () => {
    const first = { ...snapshot, limit: 1, total: 2, totalPages: 2 };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ...first,
          products: [{ ...first.products[0], available: false }],
        })
      )
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const { result } = renderHook(() =>
      useGamingSelectionDraft('merchant-1', first)
    );
    let pending = Promise.resolve();
    act(() => {
      pending = result.current.selectAll();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    act(() => result.current.clear());
    await act(async () => pending);
    expect(Object.keys(result.current.draft)).toEqual([]);
    expect(result.current.invalidCount).toBe(0);
    expect(result.current.eligible.has(id)).toBe(false);
  });
});
