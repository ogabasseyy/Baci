import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/ogabassey',
}));

vi.mock('./layout/navbar', () => ({
  OgabasseyNavbar: () => null,
}));

vi.mock('./components/AdUnit', () => ({
  AdUnit: () => null,
}));

vi.mock('./components/GoogleAdManager', () => ({
  GoogleAdManager: () => null,
}));

vi.mock('./components/deferred-shell-feature', () => ({
  DeferredShellFeature: ({ fallback = null }: { fallback?: ReactNode }) => (
    <>{fallback}</>
  ),
}));

vi.mock('./components/Footer', () => ({
  Footer: () => null,
}));

vi.mock('./components/chat/DeferredChatWidget', () => ({
  DeferredChatWidget: () => null,
}));

vi.mock('./storefront-deferred-footer-chrome', () => ({
  StorefrontDeferredFooterChrome: () => null,
}));

vi.mock('./storefront-deferred-overlay-chrome', () => ({
  StorefrontDeferredOverlayChrome: () => null,
}));

import { OgabasseyLayoutChrome } from './storefront-layout-chrome';

describe('OgabasseyLayoutChrome fallback footer touch targets', () => {
  it('gives semantic fallback footer links at least 24x24px target classes', () => {
    render(<OgabasseyLayoutChrome basePath="" section="footer" />);

    for (const name of ['About Us', 'Blog', 'FAQ']) {
      expect(screen.getByRole('link', { name })).toHaveClass(
        'min-h-6',
        'min-w-6',
        'justify-center'
      );
    }
  });
});
