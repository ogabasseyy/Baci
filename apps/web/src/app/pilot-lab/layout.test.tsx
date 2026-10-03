import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PilotLabLayout from './layout';

vi.mock('@/app/(storefront)/storefront-eager-full-css-layout', () => ({
  StorefrontEagerFullCssLayout: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-lab-css-layout="true">{children}</div>,
}));

describe('pilot lab layout', () => {
  it('serves children inside the shared storefront styles', () => {
    // Stylesheet delivery itself is proven by the browser readiness gate
    // (computed styles, not class names); this locks the composition seam.
    const html = renderToStaticMarkup(
      <PilotLabLayout>
        <p>lab child</p>
      </PilotLabLayout>
    );
    expect(html).toContain('data-lab-css-layout="true"');
    expect(html).toContain('lab child');
  });
});
