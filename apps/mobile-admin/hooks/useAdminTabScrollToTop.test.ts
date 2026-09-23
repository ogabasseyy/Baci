import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { scrollAdminTabToTop } from '@/lib/admin-tab-scroll-to-top';

import { useAdminTabScrollToTop } from './useAdminTabScrollToTop';

describe('useAdminTabScrollToTop', () => {
  it('registers the returned scroll ref under its tab route', () => {
    const { result } = renderHook(() =>
      useAdminTabScrollToTop<{
        scrollToOffset: (options: {
          offset: number;
          animated?: boolean;
        }) => void;
      }>('orders')
    );

    const scrollToOffset = vi.fn();
    result.current.current = { scrollToOffset };
    expect(scrollAdminTabToTop('orders')).toBe(true);
    expect(scrollToOffset).toHaveBeenCalledWith({ animated: true, offset: 0 });
  });
});
