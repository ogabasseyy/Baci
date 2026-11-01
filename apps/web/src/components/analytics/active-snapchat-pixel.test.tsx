import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { socialPixelContext } from '@/lib/analytics/social-pixel-context';
import { ActiveSnapchatPixel } from './active-snapchat-pixel';

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
  const view = render(
    <ActiveSnapchatPixel pixelId="11111111-1111-4111-8111-111111111111" />
  );
  const oldReady = callbacks.ready;
  view.unmount();
  const release = socialPixelContext.prepare(
    'snapchat',
    '11111111-1111-4111-8111-111111111111'
  );
  oldReady?.();
  expect(socialPixelContext.get('snapchat')?.ready).toBe(false);
  release();
});
