import { vi } from 'vitest';

// Shared collectSurface doubles, split out of the collect suite
// under the repo line ceiling: fake browser page plus the stubbed
// DOM globals the geometry reader needs.
export function rect(x = 8, y = 8, width = 40, height = 40) {
  return { height, width, x, y };
}

export function fakeImg(overrides = {}) {
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

export function fakePage() {
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

export function stubBrowser({ selectedImg, slotImg }) {
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
