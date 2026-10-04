import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectSurface,
  stripAvifCandidates,
} from './merchant-image-pilot-readiness-collect.mjs';

afterEach(() => {
  vi.unstubAllGlobals();
});

function rect(x = 8, y = 8, width = 40, height = 40) {
  return { height, width, x, y };
}

function fakeImg(overrides = {}) {
  return {
    complete: true,
    currentSrc: 'https://lab/__pilot/abc/x-768.avif',
    getAttribute: (name) =>
      name === 'srcset' ? (overrides.srcset ?? null) : null,
    getBoundingClientRect: () => rect(),
    naturalHeight: 375,
    naturalWidth: 384,
    ...overrides,
  };
}

function fakePage() {
  const listeners = {};
  return {
    evaluate: async (fn, surface) => fn(surface),
    goto: async () => undefined,
    listeners,
    on: (event, handler) => {
      listeners[event] = handler;
    },
  };
}

function stubBrowser({ selectedImg, slotImg }) {
  const selected = {
    getBoundingClientRect: () => rect(),
    parentElement: {
      getBoundingClientRect: () => rect(0, 0, 390, 844),
    },
    querySelector: () => selectedImg,
  };
  const section = {
    getAttribute: (name) =>
      name === 'data-pilot-lab-slot'
        ? 'header-logo'
        : name === 'data-pilot-lab-binding'
          ? 'merchant/logo-1'
          : name === 'data-pilot-lab-status'
            ? null
            : null,
    getBoundingClientRect: () => rect(),
    querySelector: () => slotImg,
  };
  vi.stubGlobal('document', {
    baseURI: 'https://lab/pilot-lab/store/omnimart',
    querySelector: (selector) =>
      selector === '[data-pilot-lab-selected-card]' ? selected : null,
    querySelectorAll: () => [section],
  });
  vi.stubGlobal('window', {
    devicePixelRatio: 2,
    innerHeight: 844,
    innerWidth: 390,
  });
  vi.stubGlobal('getComputedStyle', () => ({
    display: 'grid',
    objectFit: 'cover',
  }));
  vi.stubGlobal('performance', {
    getEntriesByType: () => [
      {
        encodedBodySize: 1200,
        initiatorType: 'link',
        name: 'https://lab/app.css',
      },
    ],
  });
}

describe('collectSurface', () => {
  it('collects selected w-descriptor widths and viewport geometry', async () => {
    stubBrowser({
      selectedImg: fakeImg({
        getAttribute: (name) =>
          name === 'srcset'
            ? '/__pilot/abc/x-384.avif 384w, /__pilot/abc/x-768.avif 768w'
            : null,
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const page = fakePage();
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    expect(collected.geometry.viewportWidth).toBe(390);
    expect(collected.geometry.viewportHeight).toBe(844);
    expect(collected.geometry.devicePixelRatio).toBe(2);
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(768);
    // Plain-src slot images keep natural pixels (no descriptor).
    expect(collected.geometry.slots).toHaveLength(1);
    expect(collected.geometry.slots[0]?.img?.resourceWidth).toBeNull();
    expect(collected.geometry.slots[0]?.slotId).toBe('header-logo');
    expect(collected.geometry.stylesheetBytes).toBe(1200);
  });

  it('reads w-descriptors from picture source siblings', async () => {
    // Pilot mounts carry srcsets on <source> children; the fallback <img>
    // has only src. The collector must resolve the physical width from
    // the matching source, not fall back to density-corrected naturalWidth.
    const source = {
      getAttribute: (name) =>
        name === 'srcset'
          ? '/__pilot/abc/x-384.avif 384w, /__pilot/abc/x-768.avif 768w'
          : null,
    };
    stubBrowser({
      selectedImg: fakeImg({
        getAttribute: () => null,
        parentElement: {
          querySelectorAll: () => [source],
          tagName: 'PICTURE',
        },
      }),
      slotImg: fakeImg({ srcset: null }),
    });
    const page = fakePage();
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    expect(collected.geometry.selectedImg?.resourceWidth).toBe(768);
  });

  it('fails hygiene on successful cross-origin responses', async () => {
    // Self-contained lab: a 2xx foreign font/CDN hit contaminates timing
    // exactly like a failure, so parsed-origin comparison rejects every
    // foreign response regardless of status.
    stubBrowser({ selectedImg: fakeImg(), slotImg: null });
    const page = fakePage();
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    page.listeners.response({
      headers: () => ({ 'content-type': 'font/woff2' }),
      status: () => 200,
      url: () => 'https://cdn.example.com/font.woff2',
    });
    page.listeners.response({
      headers: () => ({ 'content-type': 'text/html' }),
      status: () => 200,
      url: () => 'https://lab/store',
    });
    expect(collected.failedRequests).toHaveLength(1);
    expect(collected.failedRequests[0]).toMatch(
      /cross-origin 200 .*cdn\.example\.com/
    );
  });

  it('strips AVIF candidates while keeping the WebP fallback', () => {
    const html = [
      '<link rel="preload" as="image" type="image/avif" imagesrcset="/__pilot/g/a.avif 48w" data-pilot-lab-preload="pilot">',
      '<picture data-pilot-lab-picture="pilot">',
      '<source type="image/avif" srcset="/__pilot/g/a.avif 48w">',
      '<source type="image/webp" srcset="/__pilot/g/w.webp 48w">',
      '<img src="/__pilot/g/w.webp">',
      '</picture>',
    ].join('');
    const stripped = stripAvifCandidates(html);
    expect(stripped.stripped).toBe(2);
    expect(stripped.body).not.toContain('image/avif');
    expect(stripped.body).toContain('image/webp');
    expect(stripped.body).toContain('<img src="/__pilot/g/w.webp">');
    expect(stripAvifCandidates('<p>no candidates</p>').stripped).toBe(0);
  });

  it('routes the no-avif document through the strip and fails AVIF responses', async () => {
    stubBrowser({ selectedImg: fakeImg(), slotImg: null });
    const routes = [];
    const avifHtml =
      '<source type="image/avif" srcset="/__pilot/g/a.avif 48w"><img src="/__pilot/g/w.webp">';
    let fulfilled = null;
    const fakeRoute = {
      fetch: async () => ({ text: async () => avifHtml }),
      fulfill: (arg) => {
        fulfilled = arg;
      },
    };
    const page = {
      ...fakePage(),
      // Navigation runs the registered document route, like Playwright.
      goto: async () => {
        for (const [, handler] of routes) {
          await handler(fakeRoute);
        }
      },
      route: (predicate, handler) => {
        routes.push([predicate, handler]);
      },
    };
    const url = 'https://lab/pilot-lab/store/omnimart';
    const collected = await collectSurface(page, url, 'grid', {
      stripAvif: true,
    });
    // One document route, matching only the navigated URL.
    expect(routes).toHaveLength(1);
    const [predicate] = routes[0];
    expect(predicate(new URL(url))).toBe(true);
    expect(predicate(new URL('https://lab/__pilot/g/a.avif'))).toBe(false);
    // The fulfilled document lost its AVIF candidate and the count shows it.
    expect(fulfilled.body).not.toContain('image/avif');
    expect(fulfilled.body).toContain('<img src="/__pilot/g/w.webp">');
    expect(collected.strippedAvif).toBe(1);
    // Any AVIF response past the strip is a hole, not a fallback.
    page.listeners.response({
      headers: () => ({ 'content-type': 'image/avif' }),
      status: () => 200,
      url: () => 'https://lab/__pilot/g/a.avif',
    });
    expect(collected.failedRequests).toEqual([
      expect.stringMatching(/avif served despite no-avif/),
    ]);
  });

  it('installs no route on standard profiles', async () => {
    stubBrowser({ selectedImg: fakeImg(), slotImg: null });
    let routed = false;
    const page = {
      ...fakePage(),
      route: () => {
        routed = true;
      },
    };
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    expect(routed).toBe(false);
    expect(collected.strippedAvif).toBe(0);
  });

  it('records console, request, and image-URL hygiene', async () => {
    stubBrowser({ selectedImg: fakeImg(), slotImg: null });
    const page = fakePage();
    const collected = await collectSurface(
      page,
      'https://lab/pilot-lab/store/omnimart',
      'grid'
    );
    page.listeners.console({ text: () => 'boom', type: () => 'error' });
    page.listeners.console({ text: () => 'fine', type: () => 'log' });
    page.listeners.pageerror(new Error('page blew up'));
    page.listeners.response({
      headers: () => ({ 'content-type': 'image/avif' }),
      status: () => 200,
      url: () => 'https://lab/__pilot/abc/x.avif',
    });
    page.listeners.response({
      headers: () => ({ 'content-type': 'text/html' }),
      status: () => 500,
      url: () => 'https://lab/store',
    });
    page.listeners.requestfailed({
      failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      url: () => 'https://lab/__pilot/abc/y.avif',
    });
    expect(collected.consoleErrors).toEqual(['boom', 'Error: page blew up']);
    expect(collected.imageUrls).toEqual(['https://lab/__pilot/abc/x.avif']);
    expect(collected.failedRequests).toHaveLength(2);
    expect(collected.failedRequests[0]).toMatch(/500 .*\/store/);
    expect(collected.failedRequests[1]).toMatch(/requestfailed .*ERR_ABORTED/);
  });
});
