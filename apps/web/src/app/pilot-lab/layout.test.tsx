import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PilotLabLayout from './layout';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/app/(storefront)/storefront-eager-full-css-layout', () => ({
  StorefrontEagerFullCssLayout: ({
    children,
  }: {
    children: React.ReactNode;
  }) => <div data-lab-css-layout="true">{children}</div>,
}));

describe('pilot lab layout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves children inside the shared storefront styles', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '1');
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

  it('is a 404 without the lab flag, like every lab page', () => {
    vi.stubEnv('BACI_IMAGE_PILOT_LAB', '');
    expect(() =>
      renderToStaticMarkup(
        <PilotLabLayout>
          <p>lab child</p>
        </PilotLabLayout>
      )
    ).toThrow('NEXT_NOT_FOUND');
  });
});
