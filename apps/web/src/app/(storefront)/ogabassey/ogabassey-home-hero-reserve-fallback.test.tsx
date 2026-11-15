import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OgabasseyHomeHeroReserveFallback } from './ogabassey-home-hero-reserve-fallback';

describe('OgabasseyHomeHeroReserveFallback', () => {
  it('is invisible and non-interactive before publication resolves', () => {
    const { container } = render(<OgabasseyHomeHeroReserveFallback />);
    const reserve = container.querySelector(
      '[data-ogabassey-home-hero-reserve-fallback]'
    );
    expect(reserve).toHaveAttribute('aria-hidden', 'true');
    expect(reserve).toHaveAttribute('inert');
    expect(reserve?.querySelector('.oa-reserve')).not.toBeNull();
    expect(reserve?.querySelector('a, button, img, h1')).toBeNull();
  });
  it('uses the actual hero structure to reserve both viewport layouts', () => {
    const { container } = render(<OgabasseyHomeHeroReserveFallback />);
    expect(container.querySelector('.oa-hero .oa-intro')).not.toBeNull();
    expect(container.querySelector('.oa-hero .oa-showcase')).not.toBeNull();
    expect(container.querySelector('.oa-categories')).not.toBeNull();
  });
  it('preserves the alternate mobile omission', () => {
    const { container } = render(
      <OgabasseyHomeHeroReserveFallback omitMobileCarousel />
    );
    expect(container.querySelector('[data-ogabassey-access-hero]')).toHaveClass(
      'oa-hide-mobile'
    );
  });
});
