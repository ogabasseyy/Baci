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

import { purchaseBill } from './monnify-bills';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Monnify vend failures handed to Kuda', () => {
  describe('bugfix: which Monnify vend failures may be handed to Kuda', () => {
    function mockHttpError(
      status: number,
      statusText: string,
      message: string
    ) {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText,
        text: vi
          .fn()
          .mockResolvedValue(JSON.stringify({ responseMessage: message })),
      });
    }

    function vend() {
      return purchaseBill(
        'MTN',
        '13',
        '08012345678',
        100,
        'JANE DOE',
        'BACI-REF-123'
      );
    }

    it.each([
      [401, 'Unauthorized', 'Access denied'],
      [403, 'Forbidden', 'Invalid access token'],
    ])('marks an authentication rejection (%i) as definite', async (status, statusText, message) => {
      mockHttpError(status, statusText, message);

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: true,
        status: 'failed',
      });
    });

    it('keeps a 403 that only says "Access denied" off Kuda', async () => {
      mockHttpError(403, 'Forbidden', 'Access denied');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it.each([
      [401, 'Unauthorized', 'Duplicate vendReference'],
      [403, 'Forbidden', 'Reference already vended'],
      [403, 'Forbidden', 'Service unavailable'],
      [401, 'Unauthorized', 'Vend request failed'],
    ])('never marks an authentication answer (%i, %s) that may follow a vend as definite', async (status, statusText, message) => {
      mockHttpError(status, statusText, message);

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('never marks a 4xx carrying code 99 as definite', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            responseCode: '99',
            responseMessage: 'Insufficient wallet balance',
          })
        ),
      });

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('never marks an answer mentioning a failed vend as definite, even with refusal wording', async () => {
      mockHttpError(
        403,
        'Forbidden',
        'Vend request failed. Insufficient wallet balance'
      );

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('spots a duplicate far past the first 4 KB of the answer', async () => {
      mockHttpError(
        400,
        'Bad Request',
        `Insufficient wallet balance. ${'x'.repeat(6000)} Duplicate vendReference`
      );

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('never marks a plain-text code 99 answer as definite', async () => {
      mockHttpError(400, 'Bad Request', 'Code 99: Insufficient wallet balance');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('never marks a 403 that does not read as an auth rejection as definite', async () => {
      mockHttpError(403, 'Request Blocked', 'Gateway policy');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('never hands a 408 timeout to Kuda', async () => {
      mockHttpError(408, 'Request Timeout', 'Insufficient wallet balance');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
      });
    });

    it('spots a duplicate mentioned after the first 240 characters', async () => {
      const longTail = `Insufficient wallet balance. ${'x'.repeat(300)} Duplicate vendReference`;
      mockHttpError(400, 'Bad Request', longTail);
      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          requestSuccessful: false,
          responseCode: '01',
          responseMessage: longTail,
        }),
      });
      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
      });
    });

    it('does not mark a 4xx outside the known refusals as definite', async () => {
      mockHttpError(400, 'Bad Request', 'Invalid customer reference');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
      });
    });

    it('marks a plain 4xx refusal as definite', async () => {
      mockHttpError(400, 'Bad Request', 'Insufficient wallet balance');

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: true,
        status: 'failed',
      });
    });

    it.each([
      [409, 'Conflict', 'Request conflict'],
      [400, 'Bad Request', 'Duplicate vendReference'],
      [400, 'Bad Request', 'Reference has already been used'],
      [400, 'Bad Request', 'Reference exists'],
      [400, 'Bad Request', 'vendReference in use'],
      [422, 'Unprocessable Entity', 'Request conflict'],
    ])('never marks a duplicate reference (%i %s) as definite', async (status, statusText, message) => {
      mockHttpError(status, statusText, message);

      await expect(vend()).resolves.toMatchObject({
        providerDefiniteFailure: false,
        status: 'failed',
      });
    });
  });
});
