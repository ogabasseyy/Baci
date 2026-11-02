import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { ActiveTikTokPixel } from './active-tiktok-pixel';

const callbacks = vi.hoisted(() => ({
  ready: undefined as (() => void) | undefined,
}));
vi.mock('next/script', () => ({
  default: (props: { onReady?: () => void }) => {
    callbacks.ready = props.onReady;
    return null;
  },
}));
vi.mock('@/lib/marketing-consent', () => ({ isMarketingAllowed: () => true }));

it('does not mark a replacement merchant pixel ready from a stale callback', () => {
  const view = render(<ActiveTikTokPixel pixelId="TT123" />);
  const oldReady = callbacks.ready;
  view.unmount();
  const release = socialPixelContext.prepare('tiktok', 'TT123');
  oldReady?.();
  expect(socialPixelContext.get('tiktok')?.ready).toBe(false);
  release();
});
