import { render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { facebookPixelReady } from '@/lib/analytics/facebook-pixel-client';
import { FacebookPixel } from './facebook-pixel';

const route = vi.hoisted(() => ({ path: '/products/one' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path }));
vi.mock('next/script', () => ({
  default: ({ src }: { src: string }) => (
    <span data-testid="meta-script">{src}</span>
  ),
}));
afterEach(() => {
  localStorage.clear();
  delete window.fbq;
});
it('does not render or activate a malicious pixel ID even with analytics consent', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  window.fbq = vi.fn();
  facebookPixelReady();
  const view = render(<FacebookPixel pixelId="123');alert(1)//" />);
  expect(view.queryByTestId('meta-script')).toBeNull();
  expect(window.fbq).not.toHaveBeenCalled();
});

it('tracks each active merchant route once without broadcasting to an old pixel', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      analytics: true,
      marketing: false,
      functional: false,
    })
  );
  window.fbq = vi.fn();
  facebookPixelReady();
  const view = render(<FacebookPixel pixelId="111" />);
  expect(window.fbq).toHaveBeenCalledWith('trackSingle', '111', 'PageView', {});
  vi.mocked(window.fbq).mockClear();
  route.path = '/products/two';
  view.rerender(<FacebookPixel pixelId="111" />);
  expect(
    vi.mocked(window.fbq).mock.calls.filter((call) => call[0] === 'trackSingle')
  ).toEqual([['trackSingle', '111', 'PageView', {}]]);
  vi.mocked(window.fbq).mockClear();
  view.rerender(<FacebookPixel pixelId="222" />);
  expect(
    vi.mocked(window.fbq).mock.calls.filter((call) => call[0] === 'trackSingle')
  ).toEqual([['trackSingle', '222', 'PageView', {}]]);
  vi.mocked(window.fbq).mockClear();
  view.rerender(<FacebookPixel pixelId="222" />);
  expect(window.fbq).not.toHaveBeenCalled();
});
