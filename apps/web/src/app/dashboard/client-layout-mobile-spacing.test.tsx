import { describe, expect, it } from 'vitest';
import { renderLayout } from './client-layout.test-support';

describe('DashboardClientLayout mobile spacing', () => {
  it('reserves space under page content for the fixed mobile bottom nav', () => {
    renderLayout();
    // Without this the last action on a page (e.g. Launch quiz) sat under
    // the h-16 bottom nav on phones.
    expect(document.getElementById('main-content')).toHaveClass(
      'pb-[calc(6rem+env(safe-area-inset-bottom))]',
      'md:p-6'
    );
  });
});
