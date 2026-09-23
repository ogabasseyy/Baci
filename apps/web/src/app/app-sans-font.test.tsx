import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockNairaCssImport = vi.fn();

vi.mock('next/font/google', () => ({
  Inter: () => ({
    className: 'inter-class',
    variable: 'font-sans-inter',
  }),
}));

vi.mock('@/app/inter-naira-font.css', () => {
  mockNairaCssImport();
  return {};
});

const { AppSansFont } = await import('./app-sans-font');

describe('AppSansFont', () => {
  afterEach(() => {
    cleanup();
    document.body.className = '';
  });

  it('applies the Inter CSS variable to non-storefront app chrome', () => {
    render(
      <AppSansFont>
        <p>Dashboard copy</p>
      </AppSansFont>
    );

    expect(screen.getByText('Dashboard copy').parentElement).toHaveClass(
      'font-sans',
      'font-sans-inter',
      'font-naira'
    );
    expect(document.body).toHaveClass(
      'font-sans',
      'font-sans-inter',
      'font-naira'
    );
  });

  it('loads the naira face from the app font scope instead of first-paint CSS', () => {
    expect(mockNairaCssImport).toHaveBeenCalled();
  });
});
