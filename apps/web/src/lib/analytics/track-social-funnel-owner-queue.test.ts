import { afterEach, expect, it, vi } from 'vitest';
import { socialPixelContext } from './social-pixel-context';
import { trackSocialFunnel } from './track-social-funnel';

afterEach(() => {
  localStorage.clear();
  delete window.ttq;
});
it('does not let a stale owner fill the next owner queue', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const track = vi.fn();
  window.ttq = {
    track,
    page: vi.fn(),
    identify: vi.fn(),
    load: vi.fn(),
    instance: () => ({ track, page: vi.fn(), identify: vi.fn() }),
  };
  const items = [{ id: 'one', name: 'Phone', price: 5, quantity: 1 }];
  const releaseOld = socialPixelContext.prepare('tiktok', 'old');
  for (let i = 0; i < 100; i++)
    trackSocialFunnel('view_item', items, 'NGN', `old-${i}`);
  releaseOld();
  const releaseNew = socialPixelContext.prepare('tiktok', 'new');
  trackSocialFunnel('view_item', items, 'NGN', 'new-owner-event');
  socialPixelContext.markReady('tiktok', 'new');
  window.dispatchEvent(new Event('baci-tiktok-ready'));
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('ViewContent', expect.any(Object), {
    event_id: 'new-owner-event',
  });
  releaseNew();
});
