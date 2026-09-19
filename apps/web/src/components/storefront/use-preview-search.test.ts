import { act, render, renderHook, waitFor } from '@testing-library/react';
import type Fuse from 'fuse.js';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';
import { usePreviewSearch } from './use-preview-search';

const fuseImportState = vi.hoisted(() => ({ shouldFail: false }));

// The mocked chunk resolves once per test file and is then cached, so a
// failure flag cannot reject the import itself afterwards. Instead the
// wrapper throws during the index build, which travels the exact same
// rejection path as a rejected chunk (offline or stale deployment).
vi.mock('fuse.js', async () => {
  const actual = (await vi.importActual('fuse.js')) as {
    default: new (...args: never[]) => object;
  };
  return {
    default: class extends actual.default {
      constructor(...args: never[]) {
        if (fuseImportState.shouldFail) {
          throw new Error('ChunkLoadError');
        }
        super(...args);
      }
    },
  };
});

function buildProduct(overrides: Partial<Product>): Product {
  return {
    id: 'p1',
    name: 'Artisanal Sourdough Loaf',
    description: 'Slow-fermented country loaf',
    status: 'active',
    price: 8,
    manage_stock: false,
    stock: 0,
    image: 'img.jpg',
    imageLarge: 'img-large.jpg',
    imageHint: 'hint',
    brand: 'Bakery',
    gtin: '1',
    mpn: 'MPN',
    ...overrides,
  };
}

const products = [
  buildProduct({ id: 'p1' }),
  buildProduct({
    id: 'p2',
    name: 'Cold-Pressed Olive Oil',
    description: 'First-press olive oil',
    brand: 'Grove',
  }),
];

describe('usePreviewSearch', () => {
  beforeEach(() => {
    fuseImportState.shouldFail = false;
  });

  it('stays idle with a null index when there is no preview query', () => {
    const { result } = renderHook(() =>
      usePreviewSearch({
        debouncedSearchQuery: '',
        isPreviewMode: true,
        products,
      })
    );

    expect(result.current.fuse).toBeNull();
    expect(result.current.searchFailed).toBe(false);
  });

  it('builds a working index for preview queries without blocking every page load', async () => {
    const { result } = renderHook(() =>
      usePreviewSearch({
        debouncedSearchQuery: 'Sourdough',
        isPreviewMode: true,
        products,
      })
    );

    await waitFor(() => {
      expect(result.current.fuse).not.toBeNull();
    });
    expect(result.current.searchFailed).toBe(false);
    expect(
      result.current.fuse?.search('Sourdough').map((hit) => hit.item.id)
    ).toEqual(['p1']);
  });

  it('clears a stale index while rebuilding for a new catalog', async () => {
    // A catalog swap with the query held must not keep searching the old
    // index: until the rebuild finishes, the grid falls back to the
    // unfiltered current list instead of rendering the prior catalog.
    const catalogB = [buildProduct({ id: 'p3', name: 'Sourdough Crackers' })];
    const { result, rerender } = renderHook(
      ({ catalog }: { catalog: Product[] }) =>
        usePreviewSearch({
          debouncedSearchQuery: 'Sourdough',
          isPreviewMode: true,
          products: catalog,
        }),
      { initialProps: { catalog: products } }
    );

    await waitFor(() => {
      expect(result.current.fuse).not.toBeNull();
    });
    expect(
      result.current.fuse?.search('Sourdough').map((hit) => hit.item.id)
    ).toEqual(['p1']);

    rerender({ catalog: catalogB });
    // The rebuild is still in flight: the old index is gone immediately.
    expect(result.current.fuse).toBeNull();

    await waitFor(() => {
      expect(result.current.fuse).not.toBeNull();
    });
    expect(
      result.current.fuse?.search('Sourdough').map((hit) => hit.item.id)
    ).toEqual(['p3']);
  });

  it('never exposes the previous catalog index to any committed render', async () => {
    // Fresh evidence: rerender() flushes effects before asserting, so it
    // cannot observe the stale frame the old effect-only clear painted.
    // This probe records every render-phase value instead: the first
    // render for the new catalog must already read null, before the
    // rebuild effect has flushed.
    const seen: Array<Fuse<Product> | null> = [];
    function Probe({ catalog }: { catalog: Product[] }) {
      const { fuse } = usePreviewSearch({
        debouncedSearchQuery: 'Sourdough',
        isPreviewMode: true,
        products: catalog,
      });
      seen.push(fuse);
      return null;
    }
    const catalogB = [buildProduct({ id: 'p3', name: 'Sourdough Crackers' })];
    // createElement (not JSX): this suite stays a .ts module so the
    // extension-preserving colocated-test contract keeps matching it.
    const { rerender } = render(createElement(Probe, { catalog: products }));

    await waitFor(() => {
      expect(seen[seen.length - 1]).not.toBeNull();
    });
    seen.length = 0;

    rerender(createElement(Probe, { catalog: catalogB }));

    await waitFor(() => {
      expect(seen[seen.length - 1]).not.toBeNull();
    });
    // Every render committed for the new catalog saw a null index until
    // the rebuild for that catalog finished — no stale frame painted.
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.slice(0, -1).every((fuse) => fuse === null)).toBe(true);
  });

  it('keeps the warm index across query changes on the same catalog', async () => {
    const { result, rerender } = renderHook(
      ({ query }: { query: string }) =>
        usePreviewSearch({
          debouncedSearchQuery: query,
          isPreviewMode: true,
          products,
        }),
      { initialProps: { query: 'Sourdough' } }
    );

    await waitFor(() => {
      expect(result.current.fuse).not.toBeNull();
    });

    rerender({ query: 'Olive' });
    // Same catalog: no unfiltered flash while the already-built index
    // answers the new query.
    expect(result.current.fuse).not.toBeNull();
  });

  it('exposes a recoverable failure instead of an unhandled rejection', async () => {
    fuseImportState.shouldFail = true;
    const { result } = renderHook(() =>
      usePreviewSearch({
        debouncedSearchQuery: 'Sourdough',
        isPreviewMode: true,
        products,
      })
    );

    await waitFor(() => {
      expect(result.current.searchFailed).toBe(true);
    });
    expect(result.current.fuse).toBeNull();

    // Act: the chunk recovers and the shopper retries.
    fuseImportState.shouldFail = false;
    act(() => {
      result.current.retrySearch();
    });

    await waitFor(() => {
      expect(result.current.fuse).not.toBeNull();
    });
    expect(result.current.searchFailed).toBe(false);
  });
});
