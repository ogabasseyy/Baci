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
        'Insufficient wallet balance for +234 801 234 5678, 0801-234-5678, 0801.234.5678, (0801) 234 5678 or +234 (801) 234 5678'
      )
    ).toBe(
      'Insufficient wallet balance for [redacted], [redacted], [redacted], [redacted] or [redacted]'
    );
  });

  it('hides a grouped phone number that straddles the length cut', () => {
    const sanitized = sanitizeMonnifyErrorDetail(
      `${'x'.repeat(230)} 0801 234 5678 trailing`
    );

    expect(sanitized).not.toMatch(/0801|234 5678/);
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

    // The unscrubbed body only feeds classification; no property exposes it.
    expect('rawDetail' in error).toBe(false);
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

describe('bugfix: slash-separated phone numbers', () => {
  it.each(['0801/234/5678', '+234/801/234/5678'])('redacts %s', (phone) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${phone}`)).toBe(
      'Vend failed for [redacted]'
    );
  });
});

describe('bugfix: grouped numbers outside the 080x/090x/070x slice', () => {
  it.each([
    '0703 456 7890',
    '0745 123 4567',
    '+44 20 7946 0958',
    '+1 (415) 555-0132',
  ])('redacts %s', (phone) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${phone}`)).toBe(
      'Vend failed for [redacted]'
    );
  });
});

describe('bugfix: the length cut keeps whole trailing codes', () => {
  it('keeps "code 99" when the cut lands right after it', () => {
    const text = `${'x'.repeat(232)} code 99 and more text after the cut`;

    expect(sanitizeMonnifyErrorDetail(text)).toMatch(/code 99$/);
  });

  it('still drops a number the cut splits', () => {
    const text = `${'x'.repeat(232)} ref 12 345 678 trailing`;

    expect(sanitizeMonnifyErrorDetail(text)).not.toMatch(/\d$/);
  });
});

describe('bugfix: grouped national number without a trunk prefix', () => {
  it.each([
    '801 234 5678',
    '(801) 234-5678',
    '903.456.7890',
  ])('redacts %s', (phone) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${phone}`)).toBe(
      'Vend failed for [redacted]'
    );
  });
});

describe('bugfix: long grouped numbers without a prefix', () => {
  it.each(['44 20 7946 0958', '1 415 555 0132 99'])('redacts %s', (number) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${number}`)).toBe(
      'Vend failed for [redacted]'
    );
  });

  it('keeps a 10-digit grouped reference readable', () => {
    expect(sanitizeMonnifyErrorDetail('Ref 1234 5678 99 failed')).toBe(
      'Ref 1234 5678 99 failed'
    );
  });
});

describe('bugfix: grouped numbers separated by tabs, newlines or wide spaces', () => {
  it.each([
    '0801\t234\t5678',
    '0801\n234\n5678',
    '0801\u00a0234\u00a05678',
    '0801   234   5678',
  ])('redacts %j', (phone) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${phone}`)).toBe(
      'Vend failed for [redacted]'
    );
  });
});

describe('bugfix: dialled numbers with long whitespace runs', () => {
  it('redacts "+44    20    7946    0958"', () => {
    expect(
      sanitizeMonnifyErrorDetail('Vend failed for +44    20    7946    0958')
    ).toBe('Vend failed for [redacted]');
  });
});

describe('bugfix: 3-3-4 grouped numbers without a prefix', () => {
  it.each(['415 555 0132', '(415) 555-0132'])('redacts %s', (number) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${number}`)).toBe(
      'Vend failed for [redacted]'
    );
  });
});

describe('bugfix: underscore-grouped phone numbers', () => {
  it.each(['0801_234_5678', '+234_801_234_5678'])('redacts %s', (phone) => {
    expect(sanitizeMonnifyErrorDetail(`Vend failed for ${phone}`)).toBe(
      'Vend failed for [redacted]'
    );
  });
});

describe('bugfix: form-encoded credentials are redacted', () => {
  it.each([
    'message=Invalid+token+abc123',
    'message=Invalid%20token%20abc123',
  ])('hides the token in %s', async (body) => {
    const { createMonnifyHttpError } = await import('./monnify-bills-errors');
    const error = await createMonnifyHttpError(
      {
        status: 401,
        statusText: 'Unauthorized',
        text: async () => body,
      } as Response,
      'Monnify API error'
    );

    expect(error.diagnosticMessage).not.toContain('abc123');
  });
});

describe('bugfix: the HTTP reason phrase is scrubbed', () => {
  it('hides a phone number in statusText', async () => {
    const { createMonnifyHttpError } = await import('./monnify-bills-errors');
    const error = await createMonnifyHttpError(
      {
        status: 400,
        statusText: 'Bad Request for 08012345678',
        text: async () => '',
      } as Response,
      'Monnify API error'
    );

    expect(error.diagnosticMessage).not.toContain('08012345678');
    expect(error.statusText).not.toContain('08012345678');
  });
});
