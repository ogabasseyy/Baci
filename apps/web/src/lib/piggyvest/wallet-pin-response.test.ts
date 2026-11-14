import { describe, expect, it } from 'vitest';
import { walletPinVerificationResponse } from './wallet-pin-response';

describe('walletPinVerificationResponse', () => {
  it.each([
    [{ status: 'verified', proof: 'p', expiresAt: 'x' }, 200, undefined],
    [{ status: 'incorrect', attemptsRemaining: 2 }, 401, 'PIN_INCORRECT'],
    [{ status: 'locked', lockedUntil: 'later' }, 423, 'PIN_LOCKED'],
    [{ status: 'not_set' }, 409, 'PIN_NOT_SET'],
    [{ status: 'reset_required' }, 409, 'PIN_RESET_REQUIRED'],
    [{ status: 'too_many_proofs' }, 429, 'PIN_BUSY'],
    [{ status: 'unavailable' }, 503, 'PIN_UNAVAILABLE'],
  ] as const)('maps %o to HTTP %i', async (result, status, code) => {
    const response = walletPinVerificationResponse(result as never);
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    if (code) expect(body.code).toBe(code);
    else expect(body).toEqual({ proof: 'p', expiresAt: 'x' });
  });
});
