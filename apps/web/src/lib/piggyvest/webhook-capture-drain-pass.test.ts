import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./webhook-capture-drain', () => ({
  drainPiggyvestWebhookCaptures: vi.fn(),
}));

import {
  type DrainDeps,
  type DrainSummary,
  drainPiggyvestWebhookCaptures,
} from './webhook-capture-drain';
import { runCaptureDrainPass } from './webhook-capture-drain-pass';

const drainMock = vi.mocked(drainPiggyvestWebhookCaptures);
const deps: DrainDeps = {
  claim: async () => [],
  renew: async () => true,
  resolve: async () => true,
  verify: () => ({ status: 'unconfigured' }),
  process: async () => ({ status: 503 }),
};
const summary = (values: Partial<DrainSummary> = {}): DrainSummary => ({
  claimed: 1,
  processed: 0,
  retried: 0,
  needsReview: 0,
  ...values,
});

describe('runCaptureDrainPass', () => {
  beforeEach(() => {
    drainMock.mockReset();
  });

  it('stops when the admission deadline expires before the first claim', async () => {
    const clock = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(10_000);

    expect(await runCaptureDrainPass(deps, { limit: 5, nowMs: clock })).toEqual(
      {
        claimed: 0,
        processed: 0,
        retried: 0,
        needsReview: 0,
      }
    );
    expect(drainMock).not.toHaveBeenCalled();
  });

  it('stops admitting rows after the deadline while retaining completed work', async () => {
    let now = 0;
    drainMock.mockImplementation(async () => {
      now = 10_000;
      return summary({ processed: 1 });
    });

    expect(
      await runCaptureDrainPass(deps, { limit: 5, nowMs: () => now })
    ).toEqual(summary({ processed: 1 }));
    expect(drainMock).toHaveBeenCalledOnce();
    expect(drainMock).toHaveBeenCalledWith(deps, { limit: 1 });
  });

  it.each([
    { limit: 0, expectedCalls: 1 },
    { limit: -4, expectedCalls: 1 },
    { limit: 11, expectedCalls: 10 },
    { limit: 100, expectedCalls: 10 },
  ])('clamps requested batch limit $limit to its supported bounds', async ({
    limit,
    expectedCalls,
  }) => {
    drainMock.mockResolvedValue(summary());

    const result = await runCaptureDrainPass(deps, {
      limit,
      nowMs: () => 0,
    });

    expect(drainMock).toHaveBeenCalledTimes(expectedCalls);
    expect(drainMock).toHaveBeenCalledWith(deps, { limit: 1 });
    expect(result.claimed).toBe(expectedCalls);
  });

  it('terminates immediately when the queue is empty', async () => {
    drainMock.mockResolvedValue(summary({ claimed: 0 }));

    expect(
      await runCaptureDrainPass(deps, { limit: 10, nowMs: () => 0 })
    ).toEqual({ claimed: 0, processed: 0, retried: 0, needsReview: 0 });
    expect(drainMock).toHaveBeenCalledOnce();
  });

  it('aggregates each summary field across one-row drain calls', async () => {
    drainMock
      .mockResolvedValueOnce(summary({ processed: 1 }))
      .mockResolvedValueOnce(summary({ retried: 1 }))
      .mockResolvedValueOnce(summary({ needsReview: 1 }));

    expect(
      await runCaptureDrainPass(deps, { limit: 3, nowMs: () => 0 })
    ).toEqual({ claimed: 3, processed: 1, retried: 1, needsReview: 1 });
    expect(drainMock).toHaveBeenCalledTimes(3);
  });
});
