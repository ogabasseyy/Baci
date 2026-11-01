import { expect, it, vi } from 'vitest';
import { snapchatEvents } from './snapchat-pixel-events';
import { socialPixelContext } from './social-pixel-context';

const consent = vi.hoisted(() => ({ allowed: false }));
vi.mock('@/lib/marketing-consent', () => ({
  isMarketingAllowed: () => consent.allowed,
}));

it('does not send search events without consent, even for a ready pixel', () => {
  const release = socialPixelContext.activate('snapchat', 'pixel');
  socialPixelContext.markReady('snapchat', 'pixel');
  const send = vi.fn();
  vi.stubGlobal('snaptr', send);
  consent.allowed = false;
  snapchatEvents.search('phone');
  expect(send).not.toHaveBeenCalled();
  consent.allowed = true;
  snapchatEvents.search('phone');
  expect(send).toHaveBeenCalledOnce();
  release();
  vi.unstubAllGlobals();
});
