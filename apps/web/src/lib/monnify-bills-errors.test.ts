import { inspect } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCacheLife, mockCacheTag } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
}));

vi.mock('next/cache', () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));

vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { sanitizeMonnifyErrorDetail } from './monnify-bills';
import { MonnifyHttpError } from './monnify-bills-errors';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sanitizeMonnifyErrorDetail', () => {
  it('preserves six digit sequences and redacts seven digit sequences', () => {
    expect(sanitizeMonnifyErrorDetail('provider code 123456')).toBe(
      'provider code 123456'
    );
    expect(sanitizeMonnifyErrorDetail('provider code 1234567')).toBe(
      'provider code [redacted]'
    );
  });

  it('redacts digit sequences adjacent to letters and underscores', () => {
    expect(sanitizeMonnifyErrorDetail('customer_08012345678 id12345678')).toBe(
      'customer_[redacted] id[redacted]'
    );
  });

  it('redacts phone numbers written in groups', () => {
    expect(
      sanitizeMonnifyErrorDetail(
        'Insufficient wallet balance for +234 801 234 5678, 0801-234-5678 or 0801.234.5678'
      )
    ).toBe(
      'Insufficient wallet balance for [redacted], [redacted] or [redacted]'
    );
  });

  it('keeps grouped references that are not phone-shaped', () => {
    expect(sanitizeMonnifyErrorDetail('Ref 1234 5678 99 failed')).toBe(
      'Ref 1234 5678 99 failed'
    );
  });

  it('keeps short numbers such as status codes and amounts', () => {
    expect(sanitizeMonnifyErrorDetail('400 Bad Request: amount 50,000')).toBe(
      '400 Bad Request: amount 50,000'
    );
  });

  it('never serialises the unscrubbed body of an HTTP error', () => {
    const error = new MonnifyHttpError({
      detail: '[redacted]',
      prefix: 'Monnify API error',
      rawDetail: 'Balance low for 08012345678',
      status: 400,
      statusText: 'Bad Request',
    });

    expect(error.rawDetail).toBe('Balance low for 08012345678');
    expect(JSON.stringify(error)).not.toContain('08012345678');
    expect(inspect(error, { showHidden: true, depth: 5 })).not.toContain(
      '08012345678'
    );
  });

  it('truncates long messages to the configured detail cap', () => {
    expect(sanitizeMonnifyErrorDetail('x'.repeat(260))).toHaveLength(240);
  });

  it('drops digit sequences cut by the lookahead bound after redaction', () => {
    const result = sanitizeMonnifyErrorDetail(
      `${'1'.repeat(100)} ${'x'.repeat(198)} 9876543210`
    );

    expect(result.length).toBeLessThanOrEqual(240);
    expect(result).toContain('[redacted]');
    expect(result).not.toContain('9876');
  });
});
