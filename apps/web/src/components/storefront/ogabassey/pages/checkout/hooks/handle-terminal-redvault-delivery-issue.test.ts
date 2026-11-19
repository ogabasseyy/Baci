import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { buildCheckoutOrderSubmissionOptions } from './build-checkout-order-submission-options';
import { handleTerminalRedvaultDeliveryIssue } from './handle-terminal-redvault-delivery-issue';
import { reviewedDelivery } from './terminal-redvault-review.test-support';

vi.mock('../handlers/submit-prepared-checkout', () => ({
  submitPreparedCheckout: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => vi.clearAllMocks());

describe('handleTerminalRedvaultDeliveryIssue', () => {
  it('continues the reviewed order without requiring a fresh door quote', async () => {
    const { context, fingerprint } = reviewedDelivery('door');
    const merchant = context.merchant;
    if (!merchant) throw new Error('Missing merchant');
    const options = buildCheckoutOrderSubmissionOptions(context, merchant.id);

    await expect(
      handleTerminalRedvaultDeliveryIssue(
        context,
        merchant,
        options,
        'delivery-option'
      )
    ).resolves.toBe(true);
    expect(submitPreparedCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        identity: expect.objectContaining({ checkoutFingerprint: fingerprint }),
      }),
      { redvaultPreparedOnly: true }
    );
  });

  it('leaves unrelated payment validation issues to the ordinary checkout path', async () => {
    const { context } = reviewedDelivery('door');
    const merchant = context.merchant;
    if (!merchant) throw new Error('Missing merchant');
    const options = buildCheckoutOrderSubmissionOptions(context, merchant.id);

    await expect(
      handleTerminalRedvaultDeliveryIssue(
        context,
        merchant,
        options,
        'redvault-unavailable'
      )
    ).resolves.toBe(false);
    expect(submitPreparedCheckout).not.toHaveBeenCalled();
  });
});
