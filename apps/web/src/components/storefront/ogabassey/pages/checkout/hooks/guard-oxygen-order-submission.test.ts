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
  total?: number;
  walletAmount?: number;
  omitOpenAuthModal?: boolean;
}) {
  const openAuthModal = vi.fn();
  const pushSuccessRoute = vi.fn();
  const releaseSubmission = vi.fn();
  const context = {
    account: {
      waitForResolvedCustomerAuth: vi.fn(
        async () => overrides?.authenticated ?? true
      ),
      ...(overrides?.omitOpenAuthModal ? {} : { openAuthModal }),
    },
    navigation: {
      pushSuccessRoute,
      getHref: (path: string) => `/ogabassey${path}`,
    },
    payment: {
      currencyCode: overrides?.currencyCode ?? 'NGN',
      session: {
        method: overrides?.method ?? 'oxygen',
        total: overrides?.total ?? 50_000,
        wallet: { amountUsed: overrides?.walletAmount ?? 0 },
      },
    },
    processing: { releaseSubmission },
  } as unknown as CheckoutOrderSubmissionContext;
  return { context, openAuthModal, pushSuccessRoute, releaseSubmission };
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

  it('falls back to the login route if openAuthModal is omitted for a guest', async () => {
    const { context, pushSuccessRoute, releaseSubmission } = makeContext({
      authenticated: false,
      omitOpenAuthModal: true,
    });
    await expect(
      guardOxygenOrderSubmission(context, 'merchant-1')
    ).resolves.toBe(true);
    expect(pushSuccessRoute).toHaveBeenCalledWith('/ogabassey/account/login');
    expect(releaseSubmission).toHaveBeenCalledTimes(1);
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

  it('allows an authenticated NGN Oxygen submission when partial wallet credit leaves remaining balance', async () => {
    const { context, openAuthModal, releaseSubmission } = makeContext({
      authenticated: true,
      walletAmount: 15_000,
    });
    await expect(
      guardOxygenOrderSubmission(context, 'merchant-1')
    ).resolves.toBe(false);
    expect(openAuthModal).not.toHaveBeenCalled();
    expect(releaseSubmission).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('skips Oxygen submission guard when store credit leaves zero remaining amount', async () => {
    const { context, openAuthModal } = makeContext({
      authenticated: false,
      total: 50_000,
      walletAmount: 50_000,
    });
    await expect(
      guardOxygenOrderSubmission(context, 'merchant-1')
    ).resolves.toBe(false);
    expect(openAuthModal).not.toHaveBeenCalled();
  });
});
