'use client';

import { Landmark, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WALLET_FUNDING_COPY } from './wallet-funding-copy';

interface UtilityPaymentMethodSelectorProps {
  canUseWallet: boolean;
  isLoading: boolean;
  onFundWallet?: () => void;
  onSelectWallet: () => void;
  showWalletRow: boolean;
  walletBalance: number;
  walletLoading: boolean;
}

export function UtilityPaymentMethodSelector({
  canUseWallet,
  isLoading,
  onFundWallet,
  onSelectWallet,
  showWalletRow,
  walletBalance,
  walletLoading,
}: UtilityPaymentMethodSelectorProps) {
  const walletSubtitle = walletLoading
    ? 'Checking wallet balance...'
    : canUseWallet
      ? `₦${walletBalance.toLocaleString()} available`
      : WALLET_FUNDING_COPY.zeroBalanceHint;

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-gray-900">Payment Method</p>
      {(walletLoading || showWalletRow) && (
        <button
          type="button"
          role="radio"
          aria-checked={true}
          disabled={!canUseWallet || isLoading}
          onClick={onSelectWallet}
          className={cn(
            'w-full rounded-xl border-2 p-3 text-left transition-all',
            'flex items-center gap-3',
            'border-store-primary bg-store-primary/5',
            (!canUseWallet || isLoading) && 'cursor-not-allowed opacity-70'
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-store-primary/10 text-store-primary">
            <Wallet size={20} />
          </span>
          <span className="flex-1">
            <span className="flex items-center gap-2">
              <span className="block text-sm font-bold text-gray-900">
                Pay with wallet
              </span>
              <span className="rounded-full bg-store-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-store-primary">
                {WALLET_FUNDING_COPY.walletRecommendedBadge}
              </span>
            </span>
            <span className="block text-xs text-gray-500">
              {walletSubtitle}
            </span>
          </span>
        </button>
      )}

      {!walletLoading && !showWalletRow ? (
        <p className="text-xs text-gray-500">
          Sign in and fund your wallet to pay for utilities.
        </p>
      ) : null}

      {showWalletRow && onFundWallet ? (
        <button
          type="button"
          onClick={onFundWallet}
          disabled={isLoading}
          className={cn(
            'w-full rounded-xl border-2 border-gray-200 bg-white p-3 text-left transition-all',
            'flex items-center gap-3 hover:border-gray-300',
            isLoading && 'cursor-not-allowed opacity-70'
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-lg bg-store-primary/10 text-store-primary">
            <Landmark size={20} />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-bold text-gray-900">
              {WALLET_FUNDING_COPY.fundCta}
            </span>
            <span className="block text-xs text-gray-500">
              {WALLET_FUNDING_COPY.fundCtaSubtitle}
            </span>
          </span>
        </button>
      ) : null}
    </div>
  );
}
