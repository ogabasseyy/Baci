import { expect, it, vi } from 'vitest';
import { socialPixelContext } from './social-pixel-context';
import { tiktokEvents } from './tiktok-pixel-events';

const consent = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/lib/marketing-consent', () => ({
  isMarketingAllowed: () => consent.allowed,
}));

it('does not send search events without consent, even for a ready pixel', () => {
  const release = socialPixelContext.activate('tiktok', 'pixel');
  socialPixelContext.markReady('tiktok', 'pixel');
  const send = vi.fn();
  vi.stubGlobal('ttq', { instance: () => ({ track: send }) });
  consent.allowed = false;
  tiktokEvents.search('phone');
  expect(send).not.toHaveBeenCalled();
  consent.allowed = true;
  tiktokEvents.search('phone');
  expect(send).toHaveBeenCalledOnce();
  release();
  vi.unstubAllGlobals();
});
