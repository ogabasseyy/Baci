import { render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeferredSocialPixels } from './deferred-social-pixels';

vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return { default: () => React.lazy(() => new Promise(() => {})) };
});
afterEach(() => localStorage.clear());

it('keeps storefront content visible while an optional provider chunk is loading', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  render(
    <Suspense fallback={<p>Store loading</p>}>
      <p>Store content</p>
      <DeferredSocialPixels merchantId="merchant" tiktokPixelId="TT123" />
    </Suspense>
  );
  expect(screen.getByText('Store content')).toBeVisible();
  expect(screen.queryByText('Store loading')).not.toBeInTheDocument();
});
