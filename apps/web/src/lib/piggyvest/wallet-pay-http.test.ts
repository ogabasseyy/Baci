import { describe, expect, it, vi } from 'vitest';
import { walletPayResponse } from './wallet-pay-http';

vi.mock('server-only', () => ({}));

const OP = '11111111-1111-4111-8111-111111111111';
const answer = async (status: string, extra = {}) => {
  const response = walletPayResponse({ status, ...extra }, OP, 'purchase');
  return { status: response.status, body: await response.json() };
};

describe('walletPayResponse', () => {
  it('names the purchase when the wallet is short', async () => {
    expect(await answer('insufficient')).toEqual({
      status: 409,
      body: {
        code: 'INSUFFICIENT_FUNDS',
        error: 'Your PiggyVest wallet can not cover this purchase.',
      },
    });
  });

  it('keeps every unsettled payment re-checkable', async () => {
    for (const [status, wire] of [
      ['pending', 'payment_pending'],
      ['needs_review', 'payment_review'],
      ['refunding', 'payment_refunding'],
    ])
      expect(await answer(status)).toEqual({
        status: 202,
        body: { status: wire, operationId: OP },
      });
  });

  it('asks for the PIN again when the proof was missing or refused', async () => {
    expect((await answer('pin_refused', { reason: 'missing' })).body.code).toBe(
      'PIN_PROOF_REQUIRED'
    );
    expect((await answer('pin_refused', { reason: 'used' })).body.code).toBe(
      'PIN_PROOF_REFUSED'
    );
  });

  it('treats an unknown answer as a retryable 503, never a failure', async () => {
    expect((await answer('something_new')).status).toBe(503);
  });
});
