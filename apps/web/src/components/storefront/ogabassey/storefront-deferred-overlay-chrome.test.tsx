import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/ogabassey' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

vi.mock('./components/PopupSystem', () => ({
  PopupSystem: () => <section aria-label="Popup system" />,
}));

vi.mock('./components/OfflineNotice', () => ({
  OfflineNotice: () => <output aria-label="Offline notice" />,
}));

import { StorefrontDeferredOverlayChrome } from './storefront-deferred-overlay-chrome';

describe('StorefrontDeferredOverlayChrome', () => {
  beforeEach(() => {
    route.pathname = '/ogabassey';
  });

  it.each([
    '/account/login',
    '/ogabassey/account/login',
    '/ogabassey/checkout',
    '/auth/callback',
  ])('keeps promotional popups off %s while retaining offline feedback', (pathname) => {
    route.pathname = pathname;
    render(<StorefrontDeferredOverlayChrome />);
    expect(
      screen.queryByRole('region', { name: /popup system/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('status', { name: /offline notice/i })
    ).toBeInTheDocument();
  });

  it('removes an already mounted popup after navigating to sign-in', () => {
    const view = render(<StorefrontDeferredOverlayChrome />);
    expect(
      screen.getByRole('region', { name: /popup system/i })
    ).toBeInTheDocument();
    route.pathname = '/ogabassey/account/login';
    view.rerender(<StorefrontDeferredOverlayChrome />);
    expect(
      screen.queryByRole('region', { name: /popup system/i })
    ).not.toBeInTheDocument();
  });

  it('mounts popup and offline chrome behind the deferred overlay boundary', async () => {
    render(<StorefrontDeferredOverlayChrome />);

    expect(
      await screen.findByRole('region', { name: /popup system/i })
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('status', { name: /offline notice/i })
    ).toBeInTheDocument();
  });
});
