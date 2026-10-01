// biome-ignore-all lint/performance/noImgElement: next/image test double must render a DOM image.
import { render, screen } from '@testing-library/react';
import type { ImgHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/image', () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => (
    // biome-ignore lint/a11y/useAltText: test double forwards the page-provided alt text
    <img {...props} />
  ),
}));

vi.mock('@/config/templates', () => ({
  TEMPLATES: [
    {
      description: 'A fast commerce layout',
      id: 'modern',
      isPremium: false,
      name: 'Modern',
      previewImage: '/modern.png',
    },
  ],
}));

import AdminTemplatesPage from './page';

describe('AdminTemplatesPage', () => {
  it('describes the static surface as a catalogue', () => {
    render(<AdminTemplatesPage />);

    expect(
      screen.getByRole('heading', { name: 'Template Catalogue' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Review the storefront templates currently available to merchants.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Modern')).toBeInTheDocument();
    expect(screen.queryByText(/Manage available/i)).not.toBeInTheDocument();
  });
});
