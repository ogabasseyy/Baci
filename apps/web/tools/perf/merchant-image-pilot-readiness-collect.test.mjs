import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSurface } from './merchant-image-pilot-readiness-collect.mjs';

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
