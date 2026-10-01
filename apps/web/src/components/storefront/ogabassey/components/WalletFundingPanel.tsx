'use client';

import type {
  StorefrontWalletFundingAccount,
  StorefrontWalletTransaction,
} from '@baci/shared';
import { Copy, Landmark, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import {
  WALLET_FUNDING_TELEMETRY,
  type WalletFundingSurface,
} from '@/lib/posthog/wallet-funding-events';
import { isWalletFundingCheckLoopEnabled } from '@/lib/wallet-funding-check-loop-flag';
import { requestFundingAccount } from './wallet-funding-account-request';
import { useWalletFundingCreditPoll } from './use-wallet-funding-credit-poll';
import { WalletFundingCheckStatus } from './WalletFundingCheckStatus';
import { WalletFundingConsent } from './WalletFundingConsent';
import { WALLET_FUNDING_COPY } from './wallet-funding-copy';
import { WalletFundingNamePrompt } from './WalletFundingNamePrompt';
import { WalletFundingPhonePrompt } from './WalletFundingPhonePrompt';

interface WalletFundingPanelProps {
  account: StorefrontWalletFundingAccount | null;
  /** The explicit bank-transfer action itself is the customer's consent. */
  autoCreate?: boolean;
  customerId?: string;
  customerFirstName?: string | null;
  customerLastName?: string | null;
  customerPhone?: string | null;
  merchantSlug: string | undefined;
  onAccountCreated: (account: StorefrontWalletFundingAccount) => void;
  onUpdateCustomerPhone?: (phone: string) => Promise<{ success: boolean; error?: string }>;
  onUpdateCustomerName?: (firstName: string, lastName: string) => Promise<{ success: boolean; error?: string }>;
  onCredited?: () => void;
  onRefreshBalance?: () => void;
  onReturnToPurchase?: () => void;
  requiresConsent: boolean;
  surface: WalletFundingSurface;
  walletTransactions?: readonly StorefrontWalletTransaction[];
}

export function WalletFundingPanel({
  account,
  autoCreate = false,
  customerId,
  customerFirstName,
  customerLastName,
  customerPhone,
  merchantSlug,
  onAccountCreated,
  onUpdateCustomerName,
  onUpdateCustomerPhone,
  onCredited,
  onRefreshBalance,
  onReturnToPurchase,
  requiresConsent,
  surface,
  walletTransactions,
}: WalletFundingPanelProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoCreateAttempted, setAutoCreateAttempted] = useState(false);
  const [phonePromptOverride, setPhonePromptOverride] = useState(false);
  const [phoneRetryPending, setPhoneRetryPending] = useState(false);
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [namePromptOverride, setNamePromptOverride] = useState(false);
  const [nameRetryPending, setNameRetryPending] = useState(false);
  const [surfaceReported, setSurfaceReported] = useState(false);
  const [creditedTransactionId, setCreditedTransactionId] = useState<string | null>(null);

  const checkLoopEnabled = isWalletFundingCheckLoopEnabled() && Boolean(account);
  const creditPoll = useWalletFundingCreditPoll({
    customerId,
    enabled: checkLoopEnabled,
    knownTransactionIds: (walletTransactions ?? []).map((transaction) => transaction.id),
    merchantSlug,
    onCredited: (credit) => {
      setCreditedTransactionId(credit.id);
      onRefreshBalance?.();
      onCredited?.();
    },
    surface,
  });

  // Keep the return CTA gated until the refreshed wallet snapshot contains the
  // detected credit, otherwise checkout can still read an insufficient balance.
  const returnReady = creditedTransactionId !== null &&
    (walletTransactions ?? []).some((transaction) => transaction.id === creditedTransactionId);

  const effectiveCustomerPhone = savedPhone ?? customerPhone;
  const needsPhone = phonePromptOverride ||
    (customerPhone !== undefined && !effectiveCustomerPhone?.trim());
  const needsName = namePromptOverride;

  // Do not emit a funnel event until the merchant context has resolved.
  useEffect(() => {
    if (surfaceReported || !merchantSlug) {
      return;
    }
    setSurfaceReported(true);
    captureClientEvent(WALLET_FUNDING_TELEMETRY.events.surfaceOpened, {
      surface,
      auto_create: autoCreate,
      has_existing_account: Boolean(account),
      merchant_slug: merchantSlug,
      customer_id: customerId,
    });
  });

  const handleCreate = async () => {
    if (!merchantSlug || creating || needsPhone || needsName) return;
    captureClientEvent(WALLET_FUNDING_TELEMETRY.events.createAttempted, {
      surface,
      auto_create: autoCreate,
      merchant_slug: merchantSlug,
      customer_id: customerId,
    });
    setCreating(true);
    setError(null);
    const result = await requestFundingAccount(merchantSlug);
    if (result.kind === 'created') {
      captureClientEvent(WALLET_FUNDING_TELEMETRY.events.accountCreated, {
        surface,
        provider: result.account.provider,
        merchant_slug: merchantSlug,
        customer_id: customerId,
      });
      onAccountCreated(result.account);
    } else {
      captureClientEvent(WALLET_FUNDING_TELEMETRY.events.createFailed, {
        surface,
        reason: result.reason,
        merchant_slug: merchantSlug,
        customer_id: customerId,
      });
      if (result.reason === WALLET_FUNDING_TELEMETRY.reasons.customerPhoneRequired) {
        setPhonePromptOverride(true);
        setPhoneRetryPending(true);
      } else if (result.reason === WALLET_FUNDING_TELEMETRY.reasons.customerNameRequired) {
        setNamePromptOverride(true);
        setNameRetryPending(true);
      }
      setError(result.message);
    }
    setCreating(false);
  };

  const handlePhoneSubmit = async (phone: string) => {
    if (!onUpdateCustomerPhone) {
      return {
        success: false,
        error: WALLET_FUNDING_COPY.unavailable,
      };
    }

    const result = await onUpdateCustomerPhone(phone);
    if (result.success) {
      setSavedPhone(phone);
      setPhonePromptOverride(false);
      setAutoCreateAttempted(false);
      setError(null);
    }
    return result;
  };

  const handleNameSubmit = async (firstName: string, lastName: string) => {
    if (!onUpdateCustomerName) {
      return { success: false, error: WALLET_FUNDING_COPY.unavailable };
    }

    const result = await onUpdateCustomerName(firstName, lastName);
    if (result.success) {
      setNamePromptOverride(false);
      setNameRetryPending(true);
      setAutoCreateAttempted(false);
      setError(null);
    }
    return result;
  };

  useEffect(() => {
    if (nameRetryPending && !needsName && merchantSlug) {
      setNameRetryPending(false);
      void handleCreate();
      return;
    }
    if (phoneRetryPending && !needsPhone && merchantSlug) {
      setPhoneRetryPending(false);
      void handleCreate();
      return;
    }
    if (!autoCreate || autoCreateAttempted || account || !requiresConsent ||
        !merchantSlug || needsPhone || needsName) {
      return;
    }
    setAutoCreateAttempted(true);
    void handleCreate();
  });

  const handleCopy = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.accountNumber);
      toast({ title: WALLET_FUNDING_COPY.copied });
    } catch {
      // Clipboard access denied; the number remains visible for manual copying.
    }
  };

  return (
    <div className="rounded-xl border border-store-primary/20 bg-store-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Landmark className="text-store-primary" size={18} />
        <p className="text-sm font-bold text-gray-900">
          {WALLET_FUNDING_COPY.title}
        </p>
      </div>

      {account ? (
        <>
          <p className="text-xs text-gray-600">
            {WALLET_FUNDING_COPY.subtitle}
          </p>
          <div className="rounded-lg bg-white border border-gray-200 p-3 space-y-1">
            <p className="text-xs text-gray-500">{account.bankName}</p>
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-bold tracking-wider text-gray-900">
                {account.accountNumber}
              </p>
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Copy size={12} />
                {WALLET_FUNDING_COPY.copyCta}
              </button>
            </div>
            {account.accountName ? (
              <p className="text-xs text-gray-500">{account.accountName}</p>
            ) : null}
          </div>
          <p className="text-xs font-medium text-store-primary">
            {WALLET_FUNDING_COPY.feeNote}
          </p>
          {checkLoopEnabled ? (
            <WalletFundingCheckStatus
              creditedAmount={creditPoll.creditedAmount}
              onCheck={creditPoll.start}
              onReturnToPurchase={onReturnToPurchase}
              onRetryRefresh={onRefreshBalance}
              returnReady={returnReady}
              status={creditPoll.status}
            />
          ) : onRefreshBalance ? (
            <button
              type="button"
              onClick={onRefreshBalance}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900"
            >
              <RefreshCw size={12} />
              {WALLET_FUNDING_COPY.refreshCta}
            </button>
          ) : null}
        </>
      ) : requiresConsent && needsName && onUpdateCustomerName ? (
        <WalletFundingNamePrompt
          initialFirstName={customerFirstName}
          initialLastName={customerLastName}
          onSubmit={handleNameSubmit}
        />
      ) : requiresConsent && needsPhone && onUpdateCustomerPhone ? (
        <WalletFundingPhonePrompt onSubmit={handlePhoneSubmit} />
      ) : requiresConsent ? (
        <WalletFundingConsent
          creating={creating}
          merchantSlug={merchantSlug}
          needsPhone={needsPhone || needsName}
          onCreate={handleCreate}
          showUnavailable={
            (needsPhone && !onUpdateCustomerPhone) ||
            (needsName && !onUpdateCustomerName)
          }
        />
      ) : (
        <p className="text-xs text-gray-600">
          {WALLET_FUNDING_COPY.unavailable}
        </p>
      )}

      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}
