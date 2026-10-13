import { describe, expect, it } from 'vitest';
import {
  resolveStorefrontReadResult,
  StorefrontReadUnavailableError,
  unwrapStorefrontReadResultForCache,
} from './storefront-read-result';

describe('resolveStorefrontReadResult', () => {
  it('returns found when a successful response contains a parsed value', () => {
    const result = resolveStorefrontReadResult({
      operation: 'merchant_snapshot',
      response: { data: [{ id: 'merchant-1' }], error: null, status: 200 },
      parse: (data) => (Array.isArray(data) ? data[0] : null),
    });

    expect(result).toEqual({
      status: 'found',
      value: { id: 'merchant-1' },
    });
  });

  it('returns not_found only for a successful response without a value', () => {
    const result = resolveStorefrontReadResult({
      operation: 'merchant_snapshot',
      response: { data: [], error: null, status: 200 },
      parse: (data) => (Array.isArray(data) ? (data[0] ?? null) : null),
    });

    expect(result).toEqual({ status: 'not_found' });
  });

  it.each([
    [{ code: '57014', message: 'statement timeout' }, 'timeout'],
    [{ code: 'PGRST003', message: 'pool acquisition timeout' }, 'timeout'],
    [{ code: '23', name: 'TimeoutError' }, 'timeout'],
    [{ code: '', message: 'TypeError: fetch failed' }, 'transport'],
  ] as const)('classifies retryable read failure %j as %s', (error, kind) => {
    const result = resolveStorefrontReadResult({
      operation: 'pdp_core_snapshot',
      response: { data: null, error, status: 0 },
      parse: () => null,
    });

    expect(result).toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        kind,
        operation: 'pdp_core_snapshot',
        retryable: true,
      }),
    });
    if (error.code) {
      expect(result).toEqual({
        status: 'unavailable',
        error: expect.objectContaining({ code: error.code }),
      });
    }
  });

  it('uses HTTP status for a structured upstream outage', () => {
    const result = resolveStorefrontReadResult({
      operation: 'merchant_snapshot',
      response: {
        data: null,
        error: { code: '', message: 'upstream unavailable' },
        status: 503,
      },
      parse: () => null,
    });

    expect(result).toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        httpStatus: 503,
        kind: 'transport',
        retryable: true,
      }),
    });
  });

  it.each([
    521, 522,
  ])('classifies Cloudflare origin failure HTTP %s as retryable transport', (status) => {
    const result = resolveStorefrontReadResult({
      operation: 'pdp_core_snapshot',
      response: {
        data: null,
        error: { message: `upstream returned ${status}` },
        status,
      },
      parse: () => null,
    });

    expect(result).toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        httpStatus: status,
        kind: 'transport',
        operation: 'pdp_core_snapshot',
        retryable: true,
      }),
    });
  });

  it('classifies PostgREST connection codes (PGRST000-002) as retryable transport, before the stable-code branch', () => {
    const result = resolveStorefrontReadResult({
      operation: 'merchant_snapshot',
      // No HTTP status — the CODE alone must drive retryability, so a
      // Supabase connection/schema-cache failure is not mistaken for a
      // stable, non-retryable database error.
      response: {
        data: null,
        error: { code: 'PGRST001', message: 'could not connect' },
        status: 0,
      },
      parse: () => null,
    });

    expect(result).toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        code: 'PGRST001',
        kind: 'transport',
        retryable: true,
      }),
    });
  });

  it('does not retry a stable database permission error based on its wording', () => {
    const result = resolveStorefrontReadResult({
      operation: 'merchant_snapshot',
      response: {
        data: null,
        error: {
          code: '42501',
          message: 'permission denied after request timeout',
        },
        status: 401,
      },
      parse: () => null,
    });

    expect(result).toEqual({
      status: 'unavailable',
      error: expect.objectContaining({
        code: '42501',
        kind: 'database',
        retryable: false,
      }),
    });
  });
});

describe('unwrapStorefrontReadResultForCache', () => {
  it('returns null for genuine absence and a value for found data', () => {
    expect(
      unwrapStorefrontReadResultForCache({ status: 'not_found' })
    ).toBeNull();
    expect(
      unwrapStorefrontReadResultForCache({
        status: 'found',
        value: { id: 'product-1' },
      })
    ).toEqual({ id: 'product-1' });
  });

  it('throws typed unavailable failures before a cacheable function can return', () => {
    expect(() =>
      unwrapStorefrontReadResultForCache({
        status: 'unavailable',
        error: {
          code: '57014',
          kind: 'timeout',
          operation: 'pdp_core_snapshot',
          retryable: true,
        },
      })
    ).toThrow(StorefrontReadUnavailableError);
  });
});
