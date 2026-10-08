import { describe, expect, it } from '@jest/globals';
import type { Href } from 'expo-router';
import {
  isWalletSavingsReturnHref,
  sanitizeWalletReturnTo,
} from './sanitize-wallet-return-to';

function acceptNavigationHref(_href: Href) {}

describe('sanitizeWalletReturnTo', () => {
  it.each([
    '/',
    '/imei-check',
    '/wallet/history',
  ])('keeps valid wallet return path %s', (value) => {
    expect(sanitizeWalletReturnTo(value)).toBe(value);
  });

  it('returns a destination accepted by Expo Router typed routes', () => {
    const returnTo = sanitizeWalletReturnTo('/imei-check');

    expect(returnTo).toBe('/imei-check');
    if (returnTo) {
      acceptNavigationHref(returnTo);
    }
  });

  it.each([
    '',
    'https://evil.com',
    '//evil.com',
    '/a/../b',
    '/a/..',
    '/a/./b',
    '/a/.',
    '/a%2fb',
    '/A%2Fb',
    '/%252f',
    '/a\\b',
    '/a%5cb',
    '/%E0%A4%A',
    ['/', '/wallet'],
    null,
    undefined,
    123,
    false,
  ])('rejects unsafe wallet return value %#', (value) => {
    expect(sanitizeWalletReturnTo(value)).toBeUndefined();
  });

  describe('query values', () => {
    it('keeps an encoded slash inside a query value and round-trips it', () => {
      const href = '/utilities/tv?repeatCustomerAddress=Flat%201%2F2';

      const returnTo = sanitizeWalletReturnTo(href);

      expect(returnTo).toBe(href);
      const address = new URLSearchParams(
        (returnTo as string).split('?')[1]
      ).get('repeatCustomerAddress');
      expect(address).toBe('Flat 1/2');
    });

    it('keeps an encoded backslash inside a query value', () => {
      const href = '/utilities/electricity?repeatBillerName=Ikeja%5CEKEDC';

      expect(sanitizeWalletReturnTo(href)).toBe(href);
    });

    it('keeps a raw slash inside a query value', () => {
      const href = '/utilities/tv?repeatBillerName=DSTV/GOTV';

      expect(sanitizeWalletReturnTo(href)).toBe(href);
    });

    it.each([
      // Encoded separators in the PATH are still traversal vectors.
      '/utilities%2Ftv?repeatAmount=100',
      '/utilities%5Ctv?repeatAmount=100',
      '/utilities/%252ftv?repeatAmount=100',
      '/../utilities/tv?repeatAmount=100',
      // Nested redirect targets would grant a second, unvalidated hop.
      '/utilities/tv?returnTo=https://evil.com',
      '/utilities/tv?redirect=%2F%2Fevil.com',
      '/utilities/tv?repeatAmount=100&next=//evil.com',
      // Malformed query strings.
      '/utilities/tv?',
      '/utilities/tv?=100',
      '/utilities/tv?repeatAmount',
      '/utilities/tv?repeatAmount=%E0%A4%A',
      // Fragments are never produced by this app.
      '/utilities/tv?repeatAmount=100#/../secrets',
    ])('rejects unsafe wallet return href %s', (href) => {
      expect(sanitizeWalletReturnTo(href)).toBeUndefined();
    });
  });
});

describe('isWalletSavingsReturnHref', () => {
  it.each([
    '/wallet?action=savings',
    '/wallet?action=savings&savingsGoalId=owned-goal',
    '/wallet?savingsAmount=125&action=savings&savingsGoalId=owned-goal',
  ])('recognizes a savings handoff %s', (href) => {
    expect(isWalletSavingsReturnHref(href)).toBe(true);
  });
  it.each([
    undefined,
    null,
    '',
    '/wallet',
    '/wallet?action=topup',
    '/wallet?savingsGoalId=owned-goal',
    'https://evil.test/wallet?action=savings',
    '/wallet?action=savings&next=/orders',
  ])('rejects a non-savings handoff %p', (href) => {
    expect(isWalletSavingsReturnHref(href)).toBe(false);
  });
});
