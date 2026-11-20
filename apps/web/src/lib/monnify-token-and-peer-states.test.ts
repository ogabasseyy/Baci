import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/monnify', () => ({
  getMonnifyToken: vi.fn().mockResolvedValue('mock-token'),
}));
vi.mock('@/lib/monnify-provider-config', () => ({
  getMonnifyBaseUrl: () => 'https://sandbox.monnify.com',
}));

import { purchaseBill } from './monnify-bills';
import {
  hasBodyToken,
  hasConflictingVendStatuses,
} from './monnify-bills-status';
import { isMonnifyRequeryRejectionDefiniteFailure } from './monnify-requery-rejection';
import { isMonnifyUnresolvedAnswer } from './monnify-unresolved-answer';

beforeEach(() => {
  vi.clearAllMocks();
});

const vend = () =>
  purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', 'BACI-REF-1');

function mockJson(json: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(json),
  });
}

function mockHttpError(status: number, body: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Bad Request',
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

describe('bugfix: success beside a pending or unknown peer vend state is held', () => {
  it.each([
    [{ vendStatus: 'SUCCESS', transactionStatus: 'PENDING' }],
    [{ vendStatus: 'SUCCESS', finalStatus: 'UNKNOWN' }],
    [{ vendStatus: 'PENDING', transactionStatus: 'SUCCESS' }],
  ])('treats %j as a conflict', (body) => {
    expect(hasConflictingVendStatuses(body)).toBe(true);
  });

  it('does not treat two agreeing states as a conflict', () => {
    expect(
      hasConflictingVendStatuses({
        vendStatus: 'SUCCESS',
        transactionStatus: 'PAID',
      })
    ).toBe(false);
  });

  it('holds a fresh vend instead of settling it', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendReference: 'MFBP-1',
        vendStatus: 'SUCCESS',
        transactionStatus: 'PENDING',
      },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });
});

describe('bugfix: a bare status under customer/product is not a vend state', () => {
  it.each([
    'customer',
    'product',
    'biller',
    'account',
  ])('does not hold %s.status UNKNOWN', (parent) => {
    expect(
      isMonnifyUnresolvedAnswer({
        answer: {
          responseCode: '01',
          responseBody: { [parent]: { status: 'UNKNOWN' } },
        },
        wording: 'Invalid customer',
      })
    ).toBe(false);
  });

  it('still holds a body-level status UNKNOWN', () => {
    expect(
      isMonnifyUnresolvedAnswer({
        answer: { responseCode: '01', responseBody: { status: 'UNKNOWN' } },
        wording: 'Rejected',
      })
    ).toBe(true);
  });
});

describe('bugfix: a rejected answer that carries a real token is held', () => {
  it('detects a token in the body, not a placeholder', () => {
    expect(hasBodyToken({ responseBody: { token: '1111-2222' } })).toBe(true);
    expect(hasBodyToken({ responseBody: { metaData: { token: 'N/A' } } })).toBe(
      false
    );
    expect(hasBodyToken({})).toBe(false);
  });

  it('holds a business rejection carrying a token', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: '01',
      responseMessage: 'Invalid customer',
      responseBody: { metaData: { token: '1111-2222-3333' } },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('holds an HTTP rejection carrying a token', async () => {
    mockHttpError(400, {
      responseCode: '01',
      responseMessage: 'Invalid customer',
      responseBody: { token: '1111-2222-3333' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });

  it('does not prove a requery failed when a token is present', () => {
    expect(
      isMonnifyRequeryRejectionDefiniteFailure({
        envelope: { responseBody: { token: '1111-2222-3333' } },
        rawMessage: 'Vend failed',
      })
    ).toBe(false);
  });
});

describe('bugfix: pending with a token and no vendReference is held, not retried', () => {
  it('returns an unresolved hold without a pin', async () => {
    mockJson({
      requestSuccessful: true,
      responseCode: '0',
      responseMessage: 'success',
      responseBody: {
        transactionReference: 'MNFY-1',
        vendStatus: 'PENDING',
        metaData: { token: '1111-2222-3333' },
      },
    });

    const result = await vend();

    expect(result).toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
    expect(result.pin).toBeUndefined();
  });
});

describe('bugfix: auth codes inside an HTTP 400 body are refunded', () => {
  it.each([
    '401',
    '403',
    '429',
  ])('refunds code %s with a pending vend status', async (code) => {
    mockHttpError(400, {
      responseCode: code,
      responseMessage: 'Rejected',
      responseBody: { vendStatus: 'PENDING' },
    });

    await expect(vend()).resolves.toMatchObject({ status: 'failed' });
  });
});
