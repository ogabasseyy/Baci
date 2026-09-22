import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPush = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { useServerCategoryGraphicsFilter } from './use-server-category-graphics-filter';

describe('useServerCategoryGraphicsFilter', () => {
  beforeEach(() => {
    mockPush.mockReset();
    window.history.replaceState({}, '', '/store/gaming-laptops?page=2');
  });

  it('builds a persistent pagination path and resets paging when toggled', () => {
    const { result } = renderHook(() =>
      useServerCategoryGraphicsFilter({
        availableGraphics: ['Integrated Graphics', 'NVIDIA RTX 4070'],
        basePath: '/store',
        categoryName: 'gaming-laptops',
        selectedGraphics: ['Integrated Graphics'],
      })
    );

    expect(result.current.enabled).toBe(true);
    expect(result.current.paginationPath).toBe(
      '/store/gaming-laptops?graphics=Integrated+Graphics'
    );

    act(() => {
      result.current.toggle('NVIDIA RTX 4070', ['Integrated Graphics']);
    });

    expect(mockPush).toHaveBeenCalledWith(
      '/store/gaming-laptops?graphics=Integrated+Graphics&graphics=NVIDIA+RTX+4070'
    );
  });

  it('routes graphics changes to the category listing from a graphics hub pathname', () => {
    window.history.replaceState(
      {},
      '',
      '/store/gaming-laptops/graphics/rtx-4070?page=2'
    );
    const { result } = renderHook(() =>
      useServerCategoryGraphicsFilter({
        availableGraphics: ['Integrated Graphics', 'NVIDIA RTX 4070'],
        basePath: '/store',
        categoryName: 'gaming-laptops',
        selectedGraphics: ['Integrated Graphics'],
      })
    );

    act(() => {
      result.current.toggle('NVIDIA RTX 4070', ['Integrated Graphics']);
    });

    expect(mockPush).toHaveBeenCalledWith(
      '/store/gaming-laptops?graphics=Integrated+Graphics&graphics=NVIDIA+RTX+4070'
    );
  });

  it('mints a hub token when toggling from a hub context', () => {
    const { result } = renderHook(() =>
      useServerCategoryGraphicsFilter({
        availableGraphics: ['Integrated Graphics', 'NVIDIA RTX 4070'],
        basePath: '/store',
        categoryName: 'gaming-laptops',
        selectedGraphics: ['Integrated Graphics'],
        hubSlug: 'rtx-4070',
      })
    );

    act(() => {
      result.current.toggle('NVIDIA RTX 4070', ['Integrated Graphics']);
    });

    expect(mockPush).toHaveBeenCalledWith(
      '/store/gaming-laptops?graphics=Integrated+Graphics&graphics=NVIDIA+RTX+4070&graphicsHub=rtx-4070'
    );
  });

  it('preserves local non-graphics facets when a new URL graphics selection arrives', () => {
    const { result, rerender } = renderHook(
      ({ selectedGraphics }: { selectedGraphics: string[] }) =>
        useServerCategoryGraphicsFilter({
          availableGraphics: ['Integrated Graphics', 'NVIDIA RTX 4070'],
          basePath: '/store',
          categoryName: 'gaming-laptops',
          selectedGraphics,
        }),
      { initialProps: { selectedGraphics: ['Integrated Graphics'] } }
    );

    act(() => {
      result.current.setFilters((prev) => ({ ...prev, brand: ['Apple'] }));
    });
    expect(result.current.filters.brand).toEqual(['Apple']);

    rerender({ selectedGraphics: ['NVIDIA RTX 4070'] });

    expect(result.current.filters.graphics).toEqual(['NVIDIA RTX 4070']);
    expect(result.current.filters.brand).toEqual(['Apple']);
  });
});
