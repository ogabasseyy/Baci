import { describe, expect, it } from 'vitest';
import {
  cartErrorFromUnknown,
  isRetryableCartError,
  safeCartErrorMessage,
} from './mutation-errors';

describe('safeCartErrorMessage', () => {
  it('returns safe messages without internal details', () => {
    expect(safeCartErrorMessage('version_conflict')).toMatch(/refresh/i);
    expect(safeCartErrorMessage('unauthorized')).not.toMatch(
      /grant|claim|rls/i
    );
  });
});

describe('isRetryableCartError', () => {
  it('marks only transient failures retryable with the same key', () => {
    expect(isRetryableCartError('temporarily_unavailable')).toBe(true);
    expect(isRetryableCartError('rate_limited')).toBe(true);
    expect(isRetryableCartError('version_conflict')).toBe(false);
    expect(isRetryableCartError('idempotency_conflict')).toBe(false);
    expect(isRetryableCartError('unauthorized')).toBe(false);
  });
});

describe('cartErrorFromUnknown', () => {
  it('fails closed to temporarily_unavailable on transport failures', () => {
    expect(cartErrorFromUnknown(new Error('fetch failed'))).toBe(
      'temporarily_unavailable'
    );
    expect(cartErrorFromUnknown(null)).toBe('temporarily_unavailable');
  });
});
