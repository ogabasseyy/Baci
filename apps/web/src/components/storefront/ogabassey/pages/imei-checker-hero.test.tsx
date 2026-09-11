import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImeiCheckerHero } from './imei-checker-hero';

describe('ImeiCheckerHero', () => {
  it('renders the trust pill, headline, and trust row copy', () => {
    render(<ImeiCheckerHero />);

    expect(screen.getByText('Trusted by 10,000+ Buyers')).toBeTruthy();
    expect(screen.getByText("Don't Get Scammed.")).toBeTruthy();
    expect(screen.getByText('Verify First.')).toBeInTheDocument();
    expect(
      document.querySelector('[data-cwv-lcp-copy="imei"]')
    ).toHaveTextContent("Don't Get Scammed.");
    expect(
      document.querySelector('[data-cwv-lcp-copy="imei"]')?.textContent
    ).not.toMatch(/Verify First/);
    expect(screen.getByText('Instant Results')).toBeTruthy();
    expect(screen.getByText('Official Database')).toBeTruthy();
    expect(screen.getByText('100% Accurate')).toBeTruthy();
    expect(
      screen.getByText(/stolen, iCloud locked, or refurbished/)
    ).not.toHaveClass('sr-only');
    expect(
      screen.getByText(/stolen, iCloud locked, or refurbished/).textContent
    ).not.toMatch(/₦|NGN 500,000/);
    expect(document.querySelector('[data-cwv-lcp-support]')).toBeInTheDocument();
    expect(document.querySelector('[data-cwv-lcp-fold]')).toBeInTheDocument();
    expect(document.querySelector('[data-cwv-lcp-fold]')).not.toContainElement(
      screen.getByText(/stolen, iCloud locked, or refurbished/)
    );
    expect(document.querySelector('[data-imei-lcp-hero]')).toBeInTheDocument();
  });
});
