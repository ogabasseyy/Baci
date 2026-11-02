import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TikTokPixel } from './tiktok-pixel';

vi.mock('./active-tiktok-pixel', () => ({
  ActiveTikTokPixel: ({ pixelId }: { pixelId: string }) => (
    <span>Active TikTok {pixelId}</span>
  ),
}));
afterEach(() => localStorage.clear());
const consent = (marketing: boolean) =>
  JSON.stringify({
    necessary: true,
    functional: true,
    analytics: true,
    marketing,
  });
it('mounts only a valid ID with marketing consent and unmounts on withdrawal', () => {
  localStorage.setItem('baci-cookie-consent', consent(false));
  const view = render(<TikTokPixel pixelId="TT123" />);
  expect(screen.queryByText('Active TikTok TT123')).not.toBeInTheDocument();
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(true));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(screen.getByText('Active TikTok TT123')).toBeVisible();
  view.rerender(<TikTokPixel pixelId="bad!" />);
  expect(screen.queryByText('Active TikTok TT123')).not.toBeInTheDocument();
  view.rerender(<TikTokPixel pixelId="TT123" />);
  expect(screen.getByText('Active TikTok TT123')).toBeVisible();
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  expect(screen.queryByText('Active TikTok TT123')).not.toBeInTheDocument();
});
