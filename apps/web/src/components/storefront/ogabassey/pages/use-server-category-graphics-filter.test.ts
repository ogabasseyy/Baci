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
});
