import { expect, it } from 'vitest';
import { socialPixelContext } from './social-pixel-context';

it('bounds readiness to the currently mounted merchant pixel', () => {
  const first = socialPixelContext.activate('tiktok', 'first');
  socialPixelContext.markReady('tiktok', 'first');
  expect(socialPixelContext.get('tiktok')).toEqual({
    id: 'first',
    ready: true,
  });
  const second = socialPixelContext.activate('tiktok', 'second');
  socialPixelContext.markReady('tiktok', 'first');
  first();
  expect(socialPixelContext.get('tiktok')).toEqual({
    id: 'second',
    ready: false,
  });
  socialPixelContext.markReady('tiktok', 'second');
  second();
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
});
it('keeps platform ownership independent', () => {
  const tt = socialPixelContext.activate('tiktok', 'tt');
  const snap = socialPixelContext.activate('snapchat', 'snap');
  socialPixelContext.markReady('snapchat', 'snap');
  expect(socialPixelContext.get('tiktok')?.ready).toBe(false);
  expect(socialPixelContext.get('snapchat')?.ready).toBe(true);
  tt();
  snap();
});
