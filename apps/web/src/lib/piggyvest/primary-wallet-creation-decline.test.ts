import { describe, expect, it, vi } from 'vitest';
import { PiggyvestApiError } from './client';
import { classifyPrimaryWalletCreationDecline } from './primary-wallet-creation-decline';

vi.mock('server-only', () => ({}));

const declined = (status: number, message: string) =>
  new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', message, status, true);

describe('classifyPrimaryWalletCreationDecline', () => {
  it.each([
    400, 422,
  ])('classifies a declined %s naming payout or interest as interest routing', (status) => {
    expect(
      classifyPrimaryWalletCreationDecline(
        declined(status, 'Invalid interest payout wallet')
      )
    ).toBe('interest_routing');
  });

  it('treats only a 400 as a BVN verdict', () => {
    expect(
      classifyPrimaryWalletCreationDecline(declined(400, 'Invalid BVN'))
    ).toBe('bvn');
    expect(
      classifyPrimaryWalletCreationDecline(declined(422, 'Invalid BVN'))
    ).toBeNull();
  });

  it('needs an explicit decline to call a payout error interest routing', () => {
    expect(
      classifyPrimaryWalletCreationDecline(
        new PiggyvestApiError('PIGGYVEST_REQUEST_ERROR', 'payout', 422, false)
      )
    ).toBeNull();
  });

  it('returns null for transport errors, other statuses and non-provider errors', () => {
    expect(
      classifyPrimaryWalletCreationDecline(
        new PiggyvestApiError('PIGGYVEST_NETWORK_ERROR', 'timeout')
      )
    ).toBeNull();
    expect(
      classifyPrimaryWalletCreationDecline(declined(500, 'boom'))
    ).toBeNull();
    expect(classifyPrimaryWalletCreationDecline(new Error('x'))).toBeNull();
  });
});
