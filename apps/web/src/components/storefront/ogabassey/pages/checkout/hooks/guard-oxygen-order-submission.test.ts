import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutOrderSubmissionContext } from './checkout-order-submission-types';
import { guardOxygenOrderSubmission } from './guard-oxygen-order-submission';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  checkAvailability: vi.fn(),
  stagingEnabled: vi.fn(() => false),
}));

vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/config/oxygen-storefront-staging', () => ({
  isOxygenStorefrontStagingEnabled: mocks.stagingEnabled,
}));
vi.mock('../check-oxygen-storefront-availability', () => ({
  checkOxygenStorefrontAvailability: mocks.checkAvailability,
}));

function makeContext(overrides?: {
  method?: string;
  authenticated?: boolean;
  currencyCode?: string;
  walletAmount?: number;
}) {
  const openAuthModal = vi.fn();
  const releaseSubmission = vi.fn();
  const context = {
    account: {
      waitForResolvedCustomerAuth: vi.fn(
        async () => overrides?.authenticated ?? true
      ),
      openAuthModal,
    },
    payment: {
      currencyCode: overrides?.currencyCode ?? 'NGN',
      session: {
        method: overrides?.method ?? 'oxygen',
        wallet: { amountUsed: overrides?.walletAmount ?? 0 },
      },
    },
    processing: { releaseSubmission },
  } as unknown as CheckoutOrderSubmissionContext;
  return { context, openAuthModal, releaseSubmission };
}

describe('guardOxygenOrderSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stagingEnabled.mockReturnValue(false);
    mocks.checkAvailability.mockResolvedValue(true);
  });

  it('opens the sign-in modal when a guest submits Oxygen checkout', async () => {
    const { context, openAuthModal, releaseSubmission } = makeContext({
      authenticated: false,
    });
    await expect(
      guardOxygenOrderSubmission(context, 'merchant-1')
    ).resolves.toBe(true);
    expect(openAuthModal).toHaveBeenCalledTimes(1);
    expect(releaseSubmission).toHaveBeenCalledTimes(1);
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
  });

  it('allows an authenticated NGN Oxygen submission without wallet credit', async () => {
    const { context, openAuthModal, releaseSubmission } = makeContext({
      authenticated: true,
    });
    await expect(
      guardOxygenOrderSubmission(context, 'merchant-1')
    ).resolves.toBe(false);
    expect(openAuthModal).not.toHaveBeenCalled();
    expect(releaseSubmission).not.toHaveBeenCalled();
  });
});
