import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandLogo } from './brand-logo';

describe('BrandLogo', () => {
  it('exposes the Ogabassey mark to assistive technology', () => {
    render(<BrandLogo />);
    expect(screen.getByRole('img', { name: 'Ogabassey logo' })).toHaveAttribute('viewBox', '0 0 1080 1080');
  });
});
