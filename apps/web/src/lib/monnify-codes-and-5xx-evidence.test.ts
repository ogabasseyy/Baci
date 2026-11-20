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
  hasMonnifyAuthOrThrottleCode,
  hasMonnifyUnresolvedCode,
} from './monnify-non-definitive-code';

const vend = () =>
  purchaseBill('MTN', '13', '08012345678', 100, 'JANE DOE', 'BACI-REF-1');

beforeEach(() => {
  vi.clearAllMocks();
});

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
    statusText: 'Error',
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  });
}

describe('bugfix: ancillary codes are not an auth rejection', () => {
  it.each([
    'refund',
    'request',
    'customer',
    'error',
  ])('ignores %s.details.statusCode 401', (parent) => {
    expect(
      hasMonnifyAuthOrThrottleCode({
        responseBody: { [parent]: { details: { statusCode: 401 } } },
      })
    ).toBe(false);
  });

  it('still finds a body-level statusCode 401', () => {
    expect(
      hasMonnifyAuthOrThrottleCode({ responseBody: { statusCode: 401 } })
    ).toBe(true);
  });

  it('holds a fresh vend with refund.details.statusCode 401 and a PENDING vend', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D01',
      responseMessage: 'Rejected',
      responseBody: {
        vendStatus: 'PENDING',
        vendReference: 'MFBP-1',
        refund: { details: { statusCode: 401 } },
      },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });
});

describe('bugfix: response codes written with a reason phrase are read', () => {
  it.each([
    '500 Internal Server Error',
    '503 Service Unavailable',
    '409 Conflict',
  ])('reads %j as an open code', (value) => {
    expect(
      hasMonnifyUnresolvedCode({ responseBody: { statusCode: value } })
    ).toBe(true);
  });

  it('does not read a plain refusal code as open', () => {
    expect(
      hasMonnifyUnresolvedCode({
        responseBody: { statusCode: '400 Bad Request' },
      })
    ).toBe(false);
  });

  it('holds a fresh vend whose body says statusCode "500 Internal Server Error"', async () => {
    mockJson({
      requestSuccessful: false,
      responseCode: 'D01',
      responseMessage: 'Upstream problem',
      responseBody: { statusCode: '500 Internal Server Error' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
    });
  });
});

describe('bugfix: an HTTP 5xx that names the vend is held and requeried, not re-vended', () => {
  it("holds an HTTP 500 carrying Monnify's own vendReference", async () => {
    mockHttpError(500, {
      responseMessage: 'Upstream error',
      responseBody: { vendStatus: 'PENDING', vendReference: 'MFBP-1' },
    });

    await expect(vend()).resolves.toMatchObject({
      status: 'pending',
      providerOutcomeUnresolved: true,
      providerVendReference: 'MFBP-1',
    });
  });

  it('still retries an HTTP 500 that names nothing', async () => {
    mockHttpError(500, { responseMessage: 'Upstream error' });

    await expect(vend()).rejects.toMatchObject({
      name: 'MonnifyTransientVendError',
    });
  });
});
