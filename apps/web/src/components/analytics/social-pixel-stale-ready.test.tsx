import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { SnapchatPixel } from './snapchat-pixel';
import { TikTokPixel } from './tiktok-pixel';

const callbacks = vi.hoisted(() => new Map<string, () => void>());
vi.mock('next/script', () => ({
  default: ({ id, onReady }: { id: string; onReady?: () => void }) => {
    if (onReady) callbacks.set(id, onReady);
    return null;
  },
}));
afterEach(() => {
  localStorage.clear();
  callbacks.clear();
});

it.each([
  ['tiktok', 'TT123', 'tiktok-pixel-TT123'],
  [
    'snapchat',
    '11111111-1111-4111-8111-111111111111',
    'snapchat-pixel-11111111-1111-4111-8111-111111111111',
  ],
] as const)('ignores a stale %s ready callback after an owner switch', (destination, id, scriptId) => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    })
  );
  const view = render(
    destination === 'tiktok' ? (
      <TikTokPixel pixelId={id} />
    ) : (
      <SnapchatPixel pixelId={id} />
    )
  );
  const stale = callbacks.get(scriptId);
  expect(stale).toBeDefined();
  view.unmount();
  const releaseNew = socialPixelContext.prepare(destination, id);
  stale?.();
  expect(socialPixelContext.get(destination)?.ready).toBe(false);
  releaseNew();
});

it.each([
  ['tiktok', 'TT123', 'tiktok-pixel-TT123'],
  [
    'snapchat',
    '11111111-1111-4111-8111-111111111111',
    'snapchat-pixel-11111111-1111-4111-8111-111111111111',
  ],
] as const)('ignores an old %s ready callback after consent is regranted', (destination, id, scriptId) => {
  const consent = (marketing: boolean) =>
    JSON.stringify({
      necessary: true,
      functional: true,
      analytics: true,
      marketing,
    });
  localStorage.setItem('baci-cookie-consent', consent(true));
  const view = render(
    destination === 'tiktok' ? (
      <TikTokPixel pixelId={id} />
    ) : (
      <SnapchatPixel pixelId={id} />
    )
  );
  const stale = callbacks.get(scriptId);
  expect(stale).toBeDefined();
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(false));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  act(() => {
    localStorage.setItem('baci-cookie-consent', consent(true));
    window.dispatchEvent(new Event('cookie-consent-updated'));
  });
  stale?.();
  expect(socialPixelContext.get(destination)?.ready).toBe(false);
  view.unmount();
});
