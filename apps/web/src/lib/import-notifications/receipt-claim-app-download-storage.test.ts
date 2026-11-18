// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readReceiptClaimAppDownloadToken,
  rememberReceiptClaimAppDownloadToken,
} from './receipt-claim-app-download-storage';

describe('receipt claim app download storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('stores the latest claimed receipt token for app-download tracking', () => {
    rememberReceiptClaimAppDownloadToken('claim-token');

    expect(readReceiptClaimAppDownloadToken()).toBe('claim-token');
  });

  it('ignores empty tokens', () => {
    rememberReceiptClaimAppDownloadToken('');

    expect(readReceiptClaimAppDownloadToken()).toBeNull();
  });

  it('fails safely when sessionStorage writes throw', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() =>
      rememberReceiptClaimAppDownloadToken('claim-token')
    ).not.toThrow();
  });

  it('returns null when sessionStorage reads throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(readReceiptClaimAppDownloadToken()).toBeNull();
  });
});
