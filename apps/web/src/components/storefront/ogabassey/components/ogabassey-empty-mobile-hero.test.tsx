import { render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OGABASSEY_SHELL_BANNER_INLINE_SRC } from '@/config/ogabassey-shell-banner-inline';
import { OgabasseyEmptyMobileHero } from './ogabassey-empty-mobile-hero';

describe('OgabasseyEmptyMobileHero', () => {
  it('paints a full-width inline AVIF art image as the LCP candidate', () => {
    const { container } = render(<OgabasseyEmptyMobileHero />);

    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    // Inline data URI means zero network and paints in the first static-shell flush.
    expect(img?.getAttribute('src')).toBe(OGABASSEY_SHELL_BANNER_INLINE_SRC);
    expect(img?.getAttribute('src')).toMatch(/^data:image\/avif;base64,/);
    // Full-bleed so the element box is large enough to be the Largest
    // Contentful Paint; truthful generic copy stays an HTML overlay.
    expect(img?.className).toContain('h-full');
    expect(img?.className).toContain('w-full');
    expect(img?.className).toContain('object-cover');
    expect(img?.getAttribute('fetchpriority')).toBe('high');
    expect(img?.getAttribute('decoding')).toBe('sync');
    expect(img?.getAttribute('loading')).toBe('eager');
    expect(img?.getAttribute('width')).toBe('960');
    expect(img?.getAttribute('height')).toBe('540');
  });

  it('keeps merchant-neutral copy without a fake CTA or stock claim', () => {
    const { container } = render(<OgabasseyEmptyMobileHero />);

    expect(container.textContent).toContain("Discover what's next");
    expect(container.textContent).toContain(
      'Explore phones, laptops, gaming and more.'
    );
    expect(container.textContent).not.toMatch(/ogabassey/i);
    expect(container.textContent).not.toMatch(/in stock|shop now/i);
    expect(container.querySelector('a, button')).toBeNull();
  });

  it('is decorative and emits no preload hint or interactive control', () => {
    const html = renderToString(<OgabasseyEmptyMobileHero />);
    const template = document.createElement('template');
    template.innerHTML = html;

    const wrapper = template.content.querySelector('.mb-4');
    const img = template.content.querySelector('img');
    // Hero owns the accessible H1; this empty-feed visual stays decorative.
    expect(wrapper?.getAttribute('aria-hidden')).toBe('true');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
    expect(img?.getAttribute('alt')).toBe('');
    expect(template.content.querySelector('a')).toBeNull();
    expect(template.content.querySelector('link[rel="preload"]')).toBeNull();
  });

  it('keeps populated carousel geometry when the launch feed is empty', () => {
    const { container } = render(<OgabasseyEmptyMobileHero />);

    const panel = container.querySelector('.h-48');
    expect(panel).toBeInTheDocument();
    expect(panel?.className).toContain('rounded-2xl');
    expect(panel?.className).toContain('overflow-hidden');
  });

  it('keeps an invisible controls slot (reserve-fallback parity)', () => {
    const { container } = render(<OgabasseyEmptyMobileHero />);

    const slot = container.querySelector(
      '[data-ogabassey-mobile-controls-skeleton="reserved"]'
    );
    expect(slot).not.toBeNull();
    expect(slot).toHaveClass('invisible');
  });
});
