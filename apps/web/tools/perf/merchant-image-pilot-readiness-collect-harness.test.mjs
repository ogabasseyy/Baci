import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fakeImg,
  fakePage,
  rect,
  stubBrowser,
} from './merchant-image-pilot-readiness-collect-harness.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('merchant-image-pilot-readiness-collect-harness', () => {
  it('constructs rect, fakeImg, fakePage, and stubs browser globals', async () => {
    expect(rect(1, 2, 30, 40)).toEqual({ height: 40, width: 30, x: 1, y: 2 });

    const img = fakeImg({ srcset: 'a.avif 384w' });
    expect(img.complete).toBe(true);
    expect(img.getAttribute('srcset')).toBe('a.avif 384w');
    expect(img.getAttribute('alt')).toBeNull();
    expect(img.getBoundingClientRect()).toEqual(rect());

    const page = fakePage();
    const fn = vi.fn();
    page.on('response', fn);
    expect(page.listeners.response).toBe(fn);
    expect(await page.evaluate((s) => `${s}-ok`, 'store')).toBe('store-ok');

    stubBrowser({ selectedImg: img, slotImg: img });
    expect(globalThis.window.devicePixelRatio).toBe(2);
    expect(
      globalThis.document
        .querySelector('[data-pilot-lab-selected-card]')
        .querySelector('img')
    ).toBe(img);
    expect(globalThis.document.querySelectorAll('section')).toHaveLength(1);
    expect(globalThis.getComputedStyle().objectFit).toBe('cover');
    expect(globalThis.performance.getEntriesByType('resource')).toHaveLength(1);
  });
});
