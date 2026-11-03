import { act, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, vi } from 'vitest';
import type { StorefrontShellSnapshot } from '@/hooks/merchant/types';
import { sendFacebookPixelEvent } from '@/lib/analytics/facebook-pixel-client';
import { StorefrontShellFrame } from './storefront-shell-frame';

export const merchant = {
  id: 'merchant-1',
  user_id: 'user-1',
  business_type: 'electronics',
  slug: 'store',
  business_name: 'Test Store',
};
const shellSnapshot = {
  merchant,
  routingMode: 'domain',
  basePath: '',
  navigationCategories: [],
  chatgptPixelId: 'configured-chatgpt-pixel',
} satisfies StorefrontShellSnapshot;
export function shell(children: ReactNode) {
  return (
    <StorefrontShellFrame
      preloadHeroLcpImages={false}
      shellSnapshot={shellSnapshot}
    >
      {children}
    </StorefrontShellFrame>
  );
}
export function revealPrompt() {
  act(() => vi.advanceTimersByTime(1000));
}
export function expectNoPixels() {
  expect(screen.queryByTestId('facebook-pixel-sdk')).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('tiktok-pixel-CT123456789')
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId('chatgpt-measurement-sdk')
  ).not.toBeInTheDocument();
}

export function withdrawOptionalConsent() {
  act(() => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: false,
        marketing: false,
        functional: false,
      })
    );
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
}

export function expectMetaPixelConfigured(queue: unknown[][]) {
  expect(queue).toContainEqual(['consent', 'grant']);
  expect(queue).toContainEqual(['init', '123456789']);
}

export function expectMetaEventsBlocked(queue: unknown[][]) {
  const callsAfterRevoke = queue.length;
  sendFacebookPixelEvent('AddToCart');
  expect(queue).toHaveLength(callsAfterRevoke);
}
