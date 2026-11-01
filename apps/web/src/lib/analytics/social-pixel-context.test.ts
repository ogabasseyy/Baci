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

it('retains the prepared owner when its deferred provider mounts', () => {
  const releasePrepared = socialPixelContext.prepare('tiktok', 'tt-deferred');
  const prepared = socialPixelContext.get('tiktok');
  const releaseProvider = socialPixelContext.activate('tiktok', 'tt-deferred');
  expect(socialPixelContext.get('tiktok')).toBe(prepared);
  socialPixelContext.markReady('tiktok', 'tt-deferred');
  expect(prepared?.ready).toBe(true);
  releaseProvider();
  expect(socialPixelContext.get('tiktok')).toBeUndefined();
  releasePrepared();
});

it('invalidates a prepared owner when the merchant changes', () => {
  const releaseFirst = socialPixelContext.prepare('tiktok', 'tt-first');
  const first = socialPixelContext.get('tiktok');
  const releaseSecond = socialPixelContext.prepare('tiktok', 'tt-second');
  const releaseProvider = socialPixelContext.activate('tiktok', 'tt-second');
  releaseFirst();
  expect(socialPixelContext.get('tiktok')).not.toBe(first);
  expect(socialPixelContext.get('tiktok')?.id).toBe('tt-second');
  releaseProvider();
  releaseSecond();
});
