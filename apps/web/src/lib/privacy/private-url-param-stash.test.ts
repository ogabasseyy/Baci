// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
    window.sessionStorage.setItem('baci:private-url-params:/p', '{not json');
    expect(readStashedPrivateParams('/p', '')).toEqual([]);

    window.sessionStorage.setItem(
      'baci:private-url-params:/p',
      JSON.stringify({ publicSearch: '', entries: [['token', 1]] })
    );
    expect(readStashedPrivateParams('/p', '')).toEqual([]);

    window.sessionStorage.setItem(
      'baci:private-url-params:/p',
      JSON.stringify({ publicSearch: '' })
    );
    expect(readStashedPrivateParams('/p', '')).toEqual([]);
  });
});
