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
    prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => (
    <a
      href={href}
      data-prefetch={prefetch === undefined ? undefined : String(prefetch)}
      {...rest}
    >
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

  it('links the banner policy CTA to the canonical privacy route', () => {
    render(<CookieConsent />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const policyLink = screen.getByRole('link', { name: /read our policy/i });
    expect(policyLink).toHaveAttribute('href', '/privacy');
    expect(policyLink).toHaveAttribute('data-prefetch', 'false');
  });

  it('mounts outside document flow before deferred utility styles arrive', () => {
    render(<CookieConsent />);
    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByRole('dialog', { name: 'Cookie consent' })).toHaveStyle({
      position: 'fixed',
      bottom: '1rem',
      width: 'auto',
      zIndex: 100,
    });
  });
});
