import { describe, expect, it, vi } from 'vitest';
import { goalCancelSubmitResponse } from './goal-cancel-responses';

vi.mock('server-only', () => ({}));

const operationId = '33333333-3333-4333-8333-333333333333';
const amounts = { principalKobo: 250000, forfeitedInterestKobo: 12000 };

describe('goalCancelSubmitResponse', () => {
  it('answers a confirmed cancel with the server split and no-store', async () => {
    const response = goalCancelSubmitResponse(
      { status: 'confirmed', amounts },
      operationId
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: 'confirmed',
      operationId,
      ...amounts,
    });
  });

  it('answers a pending cancel with 202', () => {
    expect(
      goalCancelSubmitResponse({ status: 'pending' }, operationId).status
    ).toBe(202);
  });

  it.each([
    [{ status: 'pin_refused', reason: 'missing' }, 400, 'PIN_PROOF_REQUIRED'],
    [{ status: 'pin_refused', reason: 'stale' }, 403, 'PIN_PROOF_REFUSED'],
    [{ status: 'released' }, 409, 'CANCEL_REJECTED'],
    [{ status: 'empty' }, 409, 'NOTHING_TO_REFUND'],
    [{ status: 'too_large' }, 409, 'AMOUNT_TOO_LARGE'],
    [{ status: 'expired' }, 409, 'CANCEL_EXPIRED'],
    [{ status: 'needs_review' }, 409, 'GOAL_NEEDS_REVIEW'],
    [{ status: 'busy' }, 409, 'CANCEL_BUSY'],
    [{ status: 'unavailable' }, 503, 'WALLET_UNAVAILABLE'],
    [{ status: 'conflict' }, 409, 'CANCEL_CONFLICT'],
  ] as const)('maps %j to %i %s', async (result, status, code) => {
    const response = goalCancelSubmitResponse(
      result as Parameters<typeof goalCancelSubmitResponse>[0],
      operationId
    );
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
  });
});
