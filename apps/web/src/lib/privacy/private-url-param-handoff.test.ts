// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimPendingPrivateParams,
  PENDING_HANDOFF_TTL_MS,
  readPendingPrivateParams,
  stashPrivateParamsForNavigation,
} from './private-url-param-handoff';
import {
  currentPrivateParamsId,
  readStashedPrivateParams,
} from './private-url-param-stash';

function visit(url: string, state: unknown = null) {
  window.history.replaceState(state, '', url);
}

const TARGET = '/shop/order-success?orderId=1&trackingToken=tok&email=a%40b.c';

describe('stashPrivateParamsForNavigation', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    visit('/shop/checkout/bnpl?orderId=1');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    visit('/');
  });

  it('returns the href without the private params and keeps the rest', () => {
    expect(stashPrivateParamsForNavigation(`${TARGET}#top`)).toBe(
      '/shop/order-success?orderId=1#top'
    );
  });

  it('returns an href with nothing private unchanged and stores nothing', () => {
    expect(stashPrivateParamsForNavigation('/shop/cart?x=1')).toBe(
      '/shop/cart?x=1'
    );
    expect(window.sessionStorage.length).toBe(0);
  });

  it('leaves another origin alone', () => {
    const href = 'https://other.example/p?token=abc';
    expect(stashPrivateParamsForNavigation(href)).toBe(href);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('falls back to the original href when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(stashPrivateParamsForNavigation(TARGET)).toBe(TARGET);
  });
});

describe('readPendingPrivateParams', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    visit('/shop/checkout/bnpl?orderId=1');
  });

  afterEach(() => {
    vi.useRealTimers();
    visit('/');
  });

  it('returns the values for the exact path and remaining query, in any order', () => {
    stashPrivateParamsForNavigation(
      '/shop/order-success?b=2&orderId=1&trackingToken=tok'
    );

    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=1&b=2')
    ).toEqual([['trackingToken', 'tok']]);
  });

  it('returns nothing for a different path', () => {
    stashPrivateParamsForNavigation(TARGET);

    expect(readPendingPrivateParams('/shop/track-order', 'orderId=1')).toEqual(
      []
    );
  });

  it('returns nothing for a different query', () => {
    stashPrivateParamsForNavigation(TARGET);

    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=2')
    ).toEqual([]);
    expect(readPendingPrivateParams('/shop/order-success', '')).toEqual([]);
  });

  it('returns nothing once the hand-off has expired', () => {
    vi.useFakeTimers();
    stashPrivateParamsForNavigation(TARGET);

    vi.advanceTimersByTime(PENDING_HANDOFF_TTL_MS - 1);
    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=1')
    ).not.toEqual([]);

    vi.advanceTimersByTime(1);
    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=1')
    ).toEqual([]);
  });
});

describe('claimPendingPrivateParams', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    visit('/shop/checkout/bnpl?orderId=1');
  });

  afterEach(() => {
    vi.useRealTimers();
    visit('/');
  });

  it('turns a matching hand-off into the stash of the current entry, once', () => {
    stashPrivateParamsForNavigation(TARGET);
    // The destination entry: same path and query, no stash id yet.
    window.history.pushState({}, '', '/shop/order-success?orderId=1');

    expect(claimPendingPrivateParams()).toBe(true);

    expect(currentPrivateParamsId()).not.toBeNull();
    expect(
      readStashedPrivateParams('/shop/order-success', 'orderId=1')
    ).toEqual([
      ['trackingToken', 'tok'],
      ['email', 'a@b.c'],
    ]);
    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=1')
    ).toEqual([]);
    expect(claimPendingPrivateParams()).toBe(false);
  });

  it('does not claim for a different path or query', () => {
    stashPrivateParamsForNavigation(TARGET);
    window.history.pushState({}, '', '/shop/track-order?orderId=1');

    expect(claimPendingPrivateParams()).toBe(false);
    expect(currentPrivateParamsId()).toBeNull();

    window.history.pushState({}, '', '/shop/order-success?orderId=2');
    expect(claimPendingPrivateParams()).toBe(false);
  });

  it('does not claim an expired hand-off', () => {
    vi.useFakeTimers();
    stashPrivateParamsForNavigation(TARGET);
    window.history.pushState({}, '', '/shop/order-success?orderId=1');

    vi.advanceTimersByTime(PENDING_HANDOFF_TTL_MS);

    expect(claimPendingPrivateParams()).toBe(false);
  });

  it('does not overwrite an entry that already has a stash', () => {
    stashPrivateParamsForNavigation(TARGET);
    window.history.pushState(
      { __baciPrivateParams: 'existing' },
      '',
      '/shop/order-success?orderId=1'
    );

    expect(claimPendingPrivateParams()).toBe(false);
    expect(currentPrivateParamsId()).toBe('existing');
  });
});
