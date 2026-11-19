// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRIVATE_PARAMS_STATE_KEY,
  readStashedPrivateParams,
  scrubPrivateParamsFromAddressBar,
} from './private-url-param-stash';

const realReplaceState = window.history.replaceState.bind(window.history);

function visit(url: string, state: unknown = null) {
  realReplaceState(state, '', url);
}

describe('bugfix: the scrub kept Next.js out of the loop', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    visit('/');
  });

  it('writes no Next.js internal keys, so its patched replaceState re-syncs the router', () => {
    visit('/track-order?token=abc', {
      __NA: true,
      _N: true,
      __PRIVATE_NEXTJS_INTERNALS_TREE: ['', {}],
      custom: 1,
    });
    const replaceState = vi.spyOn(window.history, 'replaceState');

    scrubPrivateParamsFromAddressBar();

    const state = replaceState.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(state).not.toHaveProperty('__NA');
    expect(state).not.toHaveProperty('_N');
    expect(state).not.toHaveProperty('__PRIVATE_NEXTJS_INTERNALS_TREE');
    expect(state.custom).toBe(1);
    expect(typeof state[PRIVATE_PARAMS_STATE_KEY]).toBe('string');
  });
});

describe('bugfix: the scrub kept Next.js out of the loop (Next.js 16.4.1 replaceState rules)', () => {
  afterEach(() => {
    window.history.replaceState = realReplaceState;
    visit('/');
  });

  it('lets the patched replaceState update the router, and keeps the stash id for a reload', () => {
    // The rule from next/dist/client/components/app-router.js: a state with
    // __NA/_N skips the router update; otherwise the URL is applied to the
    // router and the current entry's __NA and tree are copied into the state.
    const routerUrls: string[] = [];
    window.history.replaceState = (data, unused, url) => {
      const state = (data ?? {}) as Record<string, unknown>;
      if (state.__NA || state._N) return realReplaceState(data, unused, url);
      if (url) routerUrls.push(String(url));
      return realReplaceState({ ...state, __NA: true }, unused, url);
    };
    visit('/track-order?token=abc', { __NA: true });

    scrubPrivateParamsFromAddressBar();

    expect(routerUrls).toEqual(['/track-order']);
    expect(readStashedPrivateParams('/track-order', '')).toEqual([
      ['token', 'abc'],
    ]);
    expect(window.history.state).toMatchObject({ __NA: true });
  });
});

describe('bugfix: pruning ran before the address rewrite', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    visit('/');
  });

  it('keeps the oldest record when the rewrite fails', () => {
    for (let i = 0; i < 30; i++) {
      window.sessionStorage.setItem(
        `baci:private-url-params:old-${i}`,
        JSON.stringify({ savedAt: i })
      );
    }
    visit('/track-order?token=abc');
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(scrubPrivateParamsFromAddressBar()).toBe(false);

    expect(window.sessionStorage.length).toBe(30);
    expect(
      window.sessionStorage.getItem('baci:private-url-params:old-0')
    ).not.toBeNull();
  });

  it('prunes the oldest record once the rewrite succeeded', () => {
    for (let i = 0; i < 30; i++) {
      window.sessionStorage.setItem(
        `baci:private-url-params:old-${i}`,
        JSON.stringify({ savedAt: i })
      );
    }
    visit('/track-order?token=abc');

    expect(scrubPrivateParamsFromAddressBar()).toBe(true);

    expect(window.sessionStorage.length).toBe(30);
    expect(
      window.sessionStorage.getItem('baci:private-url-params:old-0')
    ).toBeNull();
  });
});

describe('bugfix: the in-memory fallback kept every record', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    visit('/');
  });

  it('evicts the oldest memory record beyond the cap', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    visit('/track-order?token=first');
    scrubPrivateParamsFromAddressBar();
    const firstState = window.history.state;
    expect(readStashedPrivateParams('/track-order', '')).toEqual([
      ['token', 'first'],
    ]);

    for (let i = 0; i < 30; i++) {
      visit(`/track-order?token=t${i}`);
      scrubPrivateParamsFromAddressBar();
    }

    visit('/track-order', firstState);
    expect(readStashedPrivateParams('/track-order', '')).toEqual([]);
  });
});
