// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRIVATE_PARAMS_STATE_KEY,
  readStashedPrivateParams,
  scrubPrivateParamsFromAddressBar,
} from './private-url-param-stash';

function visit(url: string) {
  window.history.replaceState(null, '', url);
}

describe('scrubPrivateParamsFromAddressBar', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    visit('/');
  });

  it('removes sensitive params from the address bar and stashes them', () => {
    visit('/checkout/bnpl?orderId=1&trackingToken=abc&email=a%40b.c');

    const scrubbed = scrubPrivateParamsFromAddressBar();

    expect(scrubbed).toBe(true);
    expect(window.location.search).toBe('?orderId=1');
    expect(window.location.href).not.toContain('abc');
    expect(readStashedPrivateParams('/checkout/bnpl', 'orderId=1')).toEqual([
      ['trackingToken', 'abc'],
      ['email', 'a@b.c'],
    ]);
  });

  it('keeps the hash', () => {
    visit('/track-order?token=abc#details');

    scrubPrivateParamsFromAddressBar();

    expect(window.location.pathname).toBe('/track-order');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#details');
  });

  it('does nothing when there are no sensitive params', () => {
    visit('/p?orderId=1');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    expect(scrubPrivateParamsFromAddressBar()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?orderId=1');
  });

  it('leaves the URL untouched when storage fails', () => {
    visit('/track-order?token=abc');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    const scrubbed = scrubPrivateParamsFromAddressBar();

    expect(scrubbed).toBe(false);
    expect(window.location.search).toBe('?token=abc');
  });
});

describe('readStashedPrivateParams', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    visit('/');
  });

  it('returns entries when the remaining query matches in any order', () => {
    visit('/p?a=1&b=2&token=abc');
    scrubPrivateParamsFromAddressBar();

    expect(readStashedPrivateParams('/p', 'b=2&a=1')).toEqual([
      ['token', 'abc'],
    ]);
  });

  it('does not return a stale token for a different order on the same path', () => {
    visit('/order-success?orderId=1&trackingToken=old');
    scrubPrivateParamsFromAddressBar();

    expect(readStashedPrivateParams('/order-success', 'orderId=2')).toEqual([]);
  });

  it('does not return entries stashed for another path', () => {
    visit('/a?token=abc');
    scrubPrivateParamsFromAddressBar();

    expect(readStashedPrivateParams('/b', '')).toEqual([]);
  });

  it('returns nothing for corrupt or wrongly shaped stash data', () => {
    const point = (value: string) => {
      window.sessionStorage.clear();
      window.sessionStorage.setItem('baci:private-url-params:e1', value);
      window.history.replaceState(
        { [PRIVATE_PARAMS_STATE_KEY]: 'e1' },
        '',
        '/p'
      );
      return readStashedPrivateParams('/p', '');
    };

    expect(point('{not json')).toEqual([]);
    expect(
      point(
        JSON.stringify({
          pathname: '/p',
          publicSearch: '',
          entries: [['token', 1]],
        })
      )
    ).toEqual([]);
    expect(point(JSON.stringify({ pathname: '/p', publicSearch: '' }))).toEqual(
      []
    );
  });
});

describe('bugfix: one stash per history entry, not per pathname', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    visit('/');
  });

  it('keeps custom history state keys when scrubbing', () => {
    window.history.replaceState({ keep: 'me' }, '', '/track-order?token=abc');

    scrubPrivateParamsFromAddressBar();

    expect(window.history.state.keep).toBe('me');
    expect(typeof window.history.state[PRIVATE_PARAMS_STATE_KEY]).toBe(
      'string'
    );
  });

  it('gives each order its own entry so Back to order A returns A, not B', () => {
    visit('/track-order?token=A');
    scrubPrivateParamsFromAddressBar();
    const stateA = window.history.state;

    window.history.pushState(null, '', '/track-order?token=B');
    scrubPrivateParamsFromAddressBar();
    expect(readStashedPrivateParams('/track-order', '')).toEqual([
      ['token', 'B'],
    ]);

    // Back to entry A: the browser restores A's state object.
    window.history.replaceState(stateA, '', '/track-order');

    expect(readStashedPrivateParams('/track-order', '')).toEqual([
      ['token', 'A'],
    ]);
  });

  it('still returns the entry token after a reload (state and storage survive)', () => {
    visit('/track-order?token=abc');
    scrubPrivateParamsFromAddressBar();

    expect(readStashedPrivateParams('/track-order', '')).toEqual([
      ['token', 'abc'],
    ]);
  });

  it('returns nothing for a fresh visit to the same path with no history state', () => {
    visit('/track-order?token=old');
    scrubPrivateParamsFromAddressBar();

    visit('/track-order'); // a fresh entry: state is null

    expect(readStashedPrivateParams('/track-order', '')).toEqual([]);
  });

  it('never falls back to another entry when the stash id is unknown', () => {
    visit('/track-order?token=old');
    scrubPrivateParamsFromAddressBar();

    window.history.replaceState(
      { [PRIVATE_PARAMS_STATE_KEY]: 'unknown-id' },
      '',
      '/track-order'
    );

    expect(readStashedPrivateParams('/track-order', '')).toEqual([]);
  });

  it('keeps only the newest records so storage does not grow without bound', () => {
    for (let i = 0; i < 40; i++) {
      visit(`/track-order?token=t${i}`);
      scrubPrivateParamsFromAddressBar();
    }

    const stashKeys = Object.keys(window.sessionStorage).filter((key) =>
      key.startsWith('baci:private-url-params:')
    );
    expect(stashKeys.length).toBe(30);
    expect(readStashedPrivateParams('/track-order', '')).toEqual([
      ['token', 't39'],
    ]);
  });
});
