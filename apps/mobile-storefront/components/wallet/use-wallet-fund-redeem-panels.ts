import type { User } from '@supabase/supabase-js';
import { useState } from 'react';
import type { Customer } from '@/stores/auth-store';
import { fundWallet, redeemWalletPoints } from './wallet-screen.handlers';
import type { resolveWalletRedeemPointsOutcome } from './wallet-screen.helpers';

type RedeemPointsMutation = Parameters<
  typeof resolveWalletRedeemPointsOutcome
>[0]['redeemPoints'];

/**
 * Fund + redeem panel orchestration for the wallet screen: panel
 * visibility, amounts, pending flags, resets, and the confirm handlers.
 * Route-driven initial visibility (`fund`/`redeem` actions and a required
 * amount) is seeded once from the route params at mount.
 */
export function useWalletFundRedeemPanels({
  activeMerchantId,
  activeMerchantSlug,
  customer,
  redeemPointsMutation,
  refetchWalletBalance,
  routeAction,
  routeRequiredAmount,
  user,
  walletReturnTo,
}: {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  customer?: Customer | null;
  redeemPointsMutation: RedeemPointsMutation;
  refetchWalletBalance?: () => Promise<unknown>;
  routeAction?: string;
  routeRequiredAmount: string;
  user?: User | null;
  walletReturnTo?: string;
}) {
  const [redeemPoints, setRedeemPoints] = useState('');
  const [showRedeemPanel, setShowRedeemPanel] = useState(
    routeAction === 'redeem'
  );
  const [fundAmount, setFundAmount] = useState(routeRequiredAmount);
  const [showFundPanel, setShowFundPanel] = useState(routeAction === 'fund');
  const [isFundPending, setIsFundPending] = useState(false);
  const [fundReturnTo, setFundReturnTo] = useState(walletReturnTo);

  const resetFundPanel = () => {
    setShowFundPanel(false);
    setFundAmount('');
    setFundReturnTo(walletReturnTo);
  };
  const resetRedeemPanel = () => {
    setShowRedeemPanel(false);
    setRedeemPoints('');
  };
  const handleFundWallet = () =>
    fundWallet({
      activeMerchantId,
      activeMerchantSlug,
      customer,
      fundAmount,
      refetchWalletBalance,
      resetFundPanel,
      setIsFundPending,
      user,
      walletReturnTo: fundReturnTo,
    });
  const handleRedeemPoints = () =>
    redeemWalletPoints({
      clearRedeemPoints: () => setRedeemPoints(''),
      closeRedeemPanel: () => setShowRedeemPanel(false),
      customerId: customer?.id,
      rawPoints: redeemPoints,
      redeemPoints: redeemPointsMutation,
    });

  return {
    fundAmount,
    fundReturnTo,
    handleFundWallet,
    handleRedeemPoints,
    isFundPending,
    redeemPoints,
    resetFundPanel,
    resetRedeemPanel,
    setFundAmount,
    setFundReturnTo,
    setIsFundPending,
    setRedeemPoints,
    setShowFundPanel,
    setShowRedeemPanel,
    showFundPanel,
    showRedeemPanel,
  };
}
