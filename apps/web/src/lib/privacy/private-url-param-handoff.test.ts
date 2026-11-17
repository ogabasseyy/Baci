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

const SLUG = 'shop';
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
    expect(stashPrivateParamsForNavigation(`${TARGET}#top`, SLUG)).toBe(
      '/shop/order-success?orderId=1#top'
    );
  });

  it('returns an href with nothing private unchanged and stores nothing', () => {
    expect(stashPrivateParamsForNavigation('/shop/cart?x=1', SLUG)).toBe(
      '/shop/cart?x=1'
    );
    expect(window.sessionStorage.length).toBe(0);
  });

  it('leaves another origin alone', () => {
    const href = 'https://other.example/p?token=abc';
    expect(stashPrivateParamsForNavigation(href, SLUG)).toBe(href);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('falls back to the original href when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(stashPrivateParamsForNavigation(TARGET, SLUG)).toBe(TARGET);
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
      '/shop/order-success?b=2&orderId=1&trackingToken=tok',
      SLUG
    );

    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=1&b=2')
    ).toEqual([['trackingToken', 'tok']]);
  });

  it('returns nothing for a different path', () => {
    stashPrivateParamsForNavigation(TARGET, SLUG);

    expect(readPendingPrivateParams('/shop/track-order', 'orderId=1')).toEqual(
      []
    );
  });

  it('returns nothing for a different query', () => {
    stashPrivateParamsForNavigation(TARGET, SLUG);

    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=2')
    ).toEqual([]);
    expect(readPendingPrivateParams('/shop/order-success', '')).toEqual([]);
  });

  it('returns nothing once the hand-off has expired', () => {
    vi.useFakeTimers();
    stashPrivateParamsForNavigation(TARGET, SLUG);

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
    stashPrivateParamsForNavigation(TARGET, SLUG);
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
    stashPrivateParamsForNavigation(TARGET, SLUG);
    window.history.pushState({}, '', '/shop/track-order?orderId=1');

    expect(claimPendingPrivateParams()).toBe(false);
    expect(currentPrivateParamsId()).toBeNull();

    window.history.pushState({}, '', '/shop/order-success?orderId=2');
    expect(claimPendingPrivateParams()).toBe(false);
  });

  it('does not claim an expired hand-off', () => {
    vi.useFakeTimers();
    stashPrivateParamsForNavigation(TARGET, SLUG);
    window.history.pushState({}, '', '/shop/order-success?orderId=1');

    vi.advanceTimersByTime(PENDING_HANDOFF_TTL_MS);

    expect(claimPendingPrivateParams()).toBe(false);
  });

  it('does not overwrite an entry that already has a stash', () => {
    stashPrivateParamsForNavigation(TARGET, SLUG);
    window.history.pushState(
      { __baciPrivateParams: 'existing' },
      '',
      '/shop/order-success?orderId=1'
    );

    expect(claimPendingPrivateParams()).toBe(false);
    expect(currentPrivateParamsId()).toBe('existing');
  });
});

describe('slug-tolerant matching (custom domains drop the slug prefix)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    visit('/shop/checkout/bnpl?orderId=1');
  });

  afterEach(() => {
    visit('/');
  });

  it('matches the unprefixed destination of a slug-prefixed push', () => {
    stashPrivateParamsForNavigation(TARGET, SLUG);

    expect(readPendingPrivateParams('/order-success', 'orderId=1')).toEqual([
      ['trackingToken', 'tok'],
      ['email', 'a@b.c'],
    ]);
  });

  it('matches the slug-prefixed destination of an unprefixed push', () => {
    stashPrivateParamsForNavigation(
      '/order-success?orderId=1&trackingToken=tok',
      SLUG
    );

    expect(
      readPendingPrivateParams('/shop/order-success', 'orderId=1')
    ).toEqual([['trackingToken', 'tok']]);
    expect(readPendingPrivateParams('/order-success', 'orderId=1')).toEqual([
      ['trackingToken', 'tok'],
    ]);
  });

  it('still refuses a different page or query, with or without the prefix', () => {
    stashPrivateParamsForNavigation(TARGET, SLUG);

    expect(readPendingPrivateParams('/track-order', 'orderId=1')).toEqual([]);
    expect(readPendingPrivateParams('/shop/track-order', 'orderId=1')).toEqual(
      []
    );
    expect(
      readPendingPrivateParams('/other/order-success', 'orderId=1')
    ).toEqual([]);
    expect(readPendingPrivateParams('/order-success', 'orderId=2')).toEqual([]);
  });

  it('claims on the unprefixed destination', () => {
    stashPrivateParamsForNavigation(TARGET, SLUG);
    window.history.pushState({}, '', '/order-success?orderId=1');

    expect(claimPendingPrivateParams()).toBe(true);
    expect(readStashedPrivateParams('/order-success', 'orderId=1')).toEqual([
      ['trackingToken', 'tok'],
      ['email', 'a@b.c'],
    ]);
  });

  it('keeps the token in the href when the slug is unknown, so a paid order is never stranded', () => {
    expect(stashPrivateParamsForNavigation(TARGET, null)).toBe(TARGET);
    expect(stashPrivateParamsForNavigation(TARGET, undefined)).toBe(TARGET);
    expect(window.sessionStorage.length).toBe(0);
  });
});
