import { act, render, screen } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CookieConsent, useCookieConsent } from './cookie-consent';

// Mock dependencies required by module imports for export tests
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '' }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('CookieConsent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports CookieConsent component', () => {
    expect(CookieConsent).toBeDefined();
    expect(typeof CookieConsent).toBe('function');
  });

  it('exports useCookieConsent hook', () => {
    expect(useCookieConsent).toBeDefined();
    expect(typeof useCookieConsent).toBe('function');
  });

  it('keeps the mobile consent dialog inside the viewport', () => {
    render(<CookieConsent />);
    act(() => vi.advanceTimersByTime(1000));

    const dialog = screen.getByRole('dialog', { name: 'Cookie consent' });
    expect(dialog).toHaveClass('w-auto', 'overflow-y-auto', 'z-[100]');
    expect(dialog).not.toHaveClass('w-full');
  });

  it('links the banner policy CTA to the canonical privacy route', () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(
      screen.getByRole('link', { name: /read our policy/i })
    ).toHaveAttribute('href', '/privacy');
  });
});
