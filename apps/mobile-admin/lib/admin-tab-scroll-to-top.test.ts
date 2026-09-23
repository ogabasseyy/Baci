import { describe, expect, it, vi } from 'vitest';
import {
  registerAdminTabScrollTarget,
  scrollAdminTabToTop,
} from './admin-tab-scroll-to-top';

describe('admin tab scroll-to-top registry', () => {
  it('scrolls a registered list to offset zero', () => {
    const scrollToOffset = vi.fn();
    const unregister = registerAdminTabScrollTarget('orders', () => ({
      scrollToOffset,
    }));

    expect(scrollAdminTabToTop('orders')).toBe(true);
    expect(scrollToOffset).toHaveBeenCalledWith({ animated: true, offset: 0 });
    unregister();
  });

  it('does nothing after the screen unregisters', () => {
    const unregister = registerAdminTabScrollTarget('menu', () => ({
      scrollTo: vi.fn(),
    }));
    unregister();

    expect(scrollAdminTabToTop('menu')).toBe(false);
  });
});
