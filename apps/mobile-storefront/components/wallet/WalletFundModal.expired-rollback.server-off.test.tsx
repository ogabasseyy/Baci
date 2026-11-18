import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { WalletFundModal } from './WalletFundModal';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { createWalletContentProps } from './wallet-content.test-utils';

// merchant-1 stands in for the Ogabassey pilot (owner decision 2026-11-13).
jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string | null) => id === 'merchant-1',
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, push: jest.fn() },
}));
jest.mock('@/hooks/use-copy-to-clipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: jest.fn(), feedback: null }),
}));
let mockCapability: boolean | null = false;
jest.mock('@/lib/piggyvest-primary-capability', () => ({
  // The expiry re-probe stays in flight, so the verdict stays unknown.
  getPiggyvestPrimaryCapability: () => new Promise(() => undefined),
  usePiggyvestPrimaryCapability: () => mockCapability,
}));
jest.mock('./PiggyvestWalletSetupPanel', () => {
  const { Text } =
    jest.requireActual<typeof import('react-native')>('react-native');
  return { PiggyvestWalletSetupPanel: () => <Text>PiggyVest setup</Text> };
});

function renderPlainSheet() {
  render(
    <WalletPrimaryContext.Provider value={false}>
      <WalletFundModal
        {...createWalletContentProps()}
        creditWatch={{
          armCheck: jest.fn(),
          creditedAmount: null,
          reset: jest.fn(),
          returnCtaHref: undefined,
          status: 'idle',
        }}
        fundingAccount={null}
        merchantId="merchant-1"
        onResetFund={jest.fn()}
        showFundPanel
      />
    </WalletPrimaryContext.Provider>
  );
}

afterEach(() => {
  jest.useRealTimers();
  clearObservedPiggyvestPrimaryCapability();
  mockCapability = false;
});

describe('server keeps PiggyVest off', () => {
  it('shows the plain sheet, never PiggyVest setup, once ruled out', () => {
    observePiggyvestPrimaryCapability('merchant-1', false);

    renderPlainSheet();

    expect(screen.queryByText('PiggyVest setup')).toBeNull();
  });
});

describe('bugfix: plain sheet reopened PiggyVest setup after an expired rollback', () => {
  it('keeps PiggyVest setup closed while the stale hook still says on', () => {
    // Arrange: confirmed earlier (hook holds true), rolled back, then the
    // 60-second ruling-out expires with the re-probe unanswered.
    jest.useFakeTimers();
    mockCapability = true;
    observePiggyvestPrimaryCapability('merchant-1', false);
    jest.advanceTimersByTime(61_000);

    // Act
    renderPlainSheet();

    // Assert
    expect(screen.queryByText('PiggyVest setup')).toBeNull();
  });

  it('opens PiggyVest setup again once a fresh positive verdict lands', () => {
    mockCapability = true;
    observePiggyvestPrimaryCapability('merchant-1', true);

    renderPlainSheet();

    expect(screen.getByText('PiggyVest setup')).toBeOnTheScreen();
  });
});
