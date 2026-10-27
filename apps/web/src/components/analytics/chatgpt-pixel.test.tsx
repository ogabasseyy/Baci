import { act, render } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const routing = vi.hoisted(() => ({ pathname: '/one' }));
vi.mock('next/navigation', () => ({ usePathname: () => routing.pathname }));
vi.mock('next/script', () => ({ default: () => null }));

import { ChatgptPixel } from './chatgpt-pixel';

type PixelWindow = Window & { oaiq?: { q?: unknown[][] } };
afterEach(() => {
  delete (window as PixelWindow).oaiq;
  localStorage.clear();
  routing.pathname = '/one';
});
describe('ChatGPT Pixel navigation and consent', () => {
  it('preserves the saved measurement choice when leaving a page that mounted the Pixel', () => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      })
    );
    const { unmount } = render(<ChatgptPixel pixelId="pixel-a" />);
    const queue = (window as PixelWindow).oaiq?.q;
    const before = queue?.length ?? 0;
    unmount();
    expect(queue?.slice(before)).not.toContainEqual(['consent', false]);
  });
  it('never withdraws saved consent while hydrating a server snapshot', async () => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      })
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(<ChatgptPixel pixelId="pixel-a" />);
    document.body.append(container);
    const root = hydrateRoot(container, <ChatgptPixel pixelId="pixel-a" />);
    try {
      await act(async () => {});
      expect((window as PixelWindow).oaiq?.q).toBeDefined();
      expect((window as PixelWindow).oaiq?.q).not.toContainEqual([
        'consent',
        false,
      ]);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
  it('measures a navigation without withdrawing consent or reinitializing the SDK', () => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      })
    );
    const { rerender } = render(<ChatgptPixel pixelId="pixel-a" />);
    const queue = (window as PixelWindow).oaiq?.q;
    const before = queue?.length ?? 0;
    routing.pathname = '/two';
    rerender(<ChatgptPixel pixelId="pixel-a" />);
    expect(queue?.slice(before)).toEqual([
      ['measureSingle', 'pixel-a', 'page_viewed', { type: 'contents' }],
    ]);
  });
  it('withdraws SDK consent when the user revokes measurement', () => {
    localStorage.setItem(
      'baci-cookie-consent',
      JSON.stringify({
        necessary: true,
        analytics: true,
        marketing: false,
        functional: false,
      })
    );
    render(<ChatgptPixel pixelId="pixel-a" />);
    act(() => {
      localStorage.setItem(
        'baci-cookie-consent',
        JSON.stringify({ analytics: false })
      );
      window.dispatchEvent(new Event('cookie-consent-updated'));
    });
    expect((window as PixelWindow).oaiq?.q?.at(-1)).toEqual(['consent', false]);
  });
});
