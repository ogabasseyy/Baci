import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const imports = vi.hoisted(() => ({ core: vi.fn(), blog: vi.fn() }));
vi.mock('@/app/(storefront)/storefront-core.css', () => {
  imports.core();
  return {};
});
vi.mock('@/app/(storefront)/storefront-blog.css', () => {
  imports.blog();
  return {};
});

import Layout, { unstable_instant } from './layout';

describe('blog initial styles', () => {
  it('loads chrome and listing styles before rendering or user input', () => {
    expect(imports.core).toHaveBeenCalledOnce();
    expect(imports.blog).toHaveBeenCalledOnce();
    render(
      <Layout>
        <main>Blog content</main>
      </Layout>
    );
    expect(screen.getByRole('main')).toHaveTextContent('Blog content');
  });
  it('preserves static-shell validation configuration', () => {
    expect(unstable_instant).toBe(false);
  });
});
