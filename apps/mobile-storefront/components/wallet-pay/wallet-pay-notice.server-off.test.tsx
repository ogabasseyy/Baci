import { walletPayNotice } from './wallet-pay-notice';

// Pure wording: the same whether or not the server has PiggyVest on.
describe('walletPayNotice', () => {
  it('says a failed purchase is refunded exactly once', () => {
    const notice = walletPayNotice({ kind: 'refunded' }, 250_000, 'IMEI check');
    expect(notice.title).toBe('Refunded to your PiggyVest wallet');
    expect(notice.message).toContain('₦2,500');
    expect(notice.message).toContain('refunded exactly once');
    expect(notice.action).toBeNull();
  });

  it('never calls an unknown answer failed, and offers to check again', () => {
    const notice = walletPayNotice({ kind: 'pending' }, 250_000, 'IMEI check');
    expect(notice.title).toBe('Confirming your payment');
    expect(notice.message).toContain("don't pay again");
    expect(notice.action).toBe('check_again');
  });

  it('tells a paused service that nothing was taken', () => {
    const notice = walletPayNotice({ kind: 'unavailable' }, null, 'IMEI check');
    expect(notice.message).toContain('Nothing was taken');
  });

  it('uses an allow-listed reason only for a plain failure', () => {
    expect(
      walletPayNotice(
        { kind: 'failed', failedReason: 'imei_mismatch' },
        null,
        'IMEI check'
      ).message
    ).toContain('This IMEI does not match');
    expect(
      walletPayNotice(
        { kind: 'refunded', failedReason: 'imei_mismatch' },
        null,
        'IMEI check'
      ).message
    ).toContain('your payment is going back');
  });

  it('never says nothing was taken when the payment may have been sent', () => {
    for (const kind of ['sign_in', 'unavailable'] as const) {
      const notice = walletPayNotice(
        { kind, maybePaid: true },
        30_000,
        'IMEI check'
      );
      expect(notice.message).not.toContain('Nothing was taken');
      expect(notice.message).toContain("Please don't pay again");
    }
  });
});

describe('bugfix: a refused start said "Something went wrong" twice with no reason (Fable walk)', () => {
  it('names a failed payment and asks to check the details', () => {
    const notice = walletPayNotice({
      kind: 'failed',
      failedReason: 'check_details',
    });
    expect(notice.title).toBe("Payment didn't go through");
    expect(notice.message).toMatch(/Check the number and amount/);
    expect(notice.message).toMatch(/Nothing was taken/);
  });
});
