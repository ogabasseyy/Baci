import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useWalletRouteActionSetup } from './use-wallet-route-action-setup';

jest.mock('@/lib/wallet-funding-intent', () => ({
  storeWalletFundingIntent: jest.fn(async () => undefined),
}));
jest.mock('@/lib/wallet-funding-session', () => ({
  startWalletFundingSession: jest.fn(async () => null),
}));

function useHandoff(route: {
  action: string;
  intent: string;
  primary: boolean;
}) {
  const [showFundPanel, setShowFundPanel] = useState(false);
  const [showSavings, setShowSavings] = useState(true);
  const [fundAmount, setFundAmount] = useState('');
  const [fundReturnTo, setFundReturnTo] = useState<WalletReturnHref>();
  const [, setShowRedeemPanel] = useState(false);
  useWalletRouteActionSetup({
    bankTransfer: {
      openPanel: route.primary,
      canCreateFundingAccount: false,
      createFundingAccount: jest.fn(),
      hasFundingAccount: false,
      hasWalletData: true,
      isCreating: false,
      needsPhone: false,
    },
    customerId: 'test-customer',
    routeAction: route.action,
    routeIntentId: route.intent,
    routeRequiredAmount: '10000',
    walletReturnTo: '/wallet?action=savings&savingsGoalId=goal',
    setFundAmount,
    setFundReturnTo,
    setShowFundPanel,
    setShowRedeemPanel,
    setShowSavingsProgressModal: setShowSavings,
  });
  return {
    showFundPanel,
    showSavings,
    fundAmount,
    fundReturnTo,
    setShowFundPanel,
  };
}

it('keeps primary wallet setup open on the first savings-to-bank-transfer navigation', async () => {
  const { result, rerender } = renderHook(useHandoff, {
    initialProps: { action: 'savings', intent: '', primary: true },
  });
  await act(async () =>
    rerender({ action: 'bank-transfer', intent: 'first-tap', primary: true })
  );
  expect(result.current.showFundPanel).toBe(true);
  expect(result.current.showSavings).toBe(false);
  expect(result.current.fundReturnTo).toContain('savingsGoalId=goal');
  act(() => result.current.setShowFundPanel(false));
  rerender({ action: 'bank-transfer', intent: 'first-tap', primary: true });
  expect(result.current.showFundPanel).toBe(false);
  await act(async () =>
    rerender({ action: 'bank-transfer', intent: 'next-tap', primary: true })
  );
  expect(result.current.showFundPanel).toBe(true);
});

it('retains the legacy hero-only bank-transfer flow for other merchants', async () => {
  const { result, rerender } = renderHook(useHandoff, {
    initialProps: { action: 'savings', intent: '', primary: false },
  });
  await act(async () =>
    rerender({ action: 'bank-transfer', intent: 'first-tap', primary: false })
  );
  expect(result.current.showFundPanel).toBe(false);
  expect(result.current.showSavings).toBe(false);
});
