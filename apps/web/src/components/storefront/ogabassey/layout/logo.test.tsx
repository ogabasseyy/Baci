import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './logo';

describe('Logo', () => {
  it('renders an accessible SVG image without a <title> element', () => {
    const { container } = render(<Logo />);

    const svg = screen.getByRole('img', { name: 'Ogabassey Logo' });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    // Regression guard (Semrush 2026-07-10): an SVG <title> is a real <title>
    // tag in the byte stream, and document-order SEO scrapers read the FIRST
    // <title> as the page title. The logo ships inside the PPR static shell
    // BEFORE the page metadata, so it must never contribute a <title>.
    expect(container.querySelector('title')).toBeNull();
  });

  it('applies the requested height and color fill', () => {
    render(<Logo height={24} color="black" />);

    const svg = screen.getByRole('img', { name: 'Ogabassey Logo' });
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.outerHTML).toContain('#000');
  });

  it('supports color="current" to inherit the themed foreground fill', () => {
    render(<Logo height={24} color="current" />);

    const svg = screen.getByRole('img', { name: 'Ogabassey Logo' });
    expect(svg.outerHTML).toContain('currentColor');
  });
});
