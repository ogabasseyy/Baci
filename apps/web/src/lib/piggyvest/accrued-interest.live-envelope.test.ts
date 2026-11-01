import { beforeEach, describe, expect, it, vi } from 'vitest';
import { retrievePiggyvestStagingAccruedInterest } from './accrued-interest';
import { dependencies, wallet } from './accrued-interest.test-support';
import { requestPiggyvestStagingJson } from './staging-json-request';

vi.mock('./staging-json-request', () => ({
  requestPiggyvestStagingJson: vi.fn(),
}));

/**
 * The envelope the PiggyVest sandbox returned for an empty accrual history
 * (staging.piggyvest.business, 2026-10-31): extra counters beside the page,
 * and page info with no previousCursor. Integers are placeholders; the
 * evidence records types only.
 */
const observed = {
  status: true,
  message: 'Accrued interest fetched',
  data: {
    withdrawal_count: 0,
    interest_forfeiture_minimum_transactions: 4,
    paginatedPayload: {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
};

beforeEach(() => {
  vi.mocked(requestPiggyvestStagingJson)
    .mockReset()
    .mockResolvedValueOnce({ status: true, data: wallet })
    .mockResolvedValueOnce(observed);
});

describe('bugfix: retrievePiggyvestStagingAccruedInterest rejected the live envelope', () => {
  it('returns an empty observation page for the live sandbox envelope', async () => {
    await expect(
      retrievePiggyvestStagingAccruedInterest(dependencies())
    ).resolves.toEqual({
      monetaryUnits: 'unconfirmed',
      spendable: false,
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  });

  it('still rejects a live-shaped page that claims more without a cursor', async () => {
    const continuing = structuredClone(observed);
    continuing.data.paginatedPayload.pageInfo.hasNextPage = true;
    vi.mocked(requestPiggyvestStagingJson)
      .mockReset()
      .mockResolvedValueOnce({ status: true, data: wallet })
      .mockResolvedValueOnce(continuing);
    await expect(
      retrievePiggyvestStagingAccruedInterest(dependencies())
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
