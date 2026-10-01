'use client';

import { useState } from 'react';
import { isValidNigerianPhone } from '@baci/shared';
import { WALLET_FUNDING_COPY } from './wallet-funding-copy';

interface WalletFundingPhonePromptProps {
  onSubmit: (phone: string) => Promise<{ success: boolean; error?: string }>;
}

export function WalletFundingPhonePrompt({
  onSubmit,
}: WalletFundingPhonePromptProps) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const normalizedPhone = phone.trim();
    if (!isValidNigerianPhone(normalizedPhone)) {
      setError(WALLET_FUNDING_COPY.invalidPhone);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const result = await onSubmit(normalizedPhone);
      if (!result.success) {
        setError(result.error ?? WALLET_FUNDING_COPY.phoneSaveFailed);
      }
    } catch {
      setError(WALLET_FUNDING_COPY.phoneSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-store-background-text/70">
        Add your phone number so we can create your wallet bank-transfer account
        number.
      </p>
      <p className="text-xs text-store-background-text/70">
        {WALLET_FUNDING_COPY.consentBlurb}
      </p>
      <p className="text-xs font-medium text-store-primary">
        {WALLET_FUNDING_COPY.feeNote}
      </p>
      <label
        className="block text-xs font-semibold text-store-background-text/80"
        htmlFor="wallet-funding-phone"
      >
        Phone number
      </label>
      <input
        aria-label="Phone number"
        autoComplete="tel"
        className="w-full rounded-xl border border-store-border bg-store-secondary px-3 py-2.5 text-sm text-store-background-text outline-none focus:border-store-primary focus:ring-1 focus:ring-store-primary"
        disabled={saving}
        id="wallet-funding-phone"
        inputMode="tel"
        onChange={(event) => {
          setPhone(event.target.value);
          if (error) {
            setError(null);
          }
        }}
        placeholder="08012345678"
        type="tel"
        value={phone}
      />
      {error ? (
        <p className="text-xs font-medium text-[var(--store-danger-text,#dc2626)]">
          {error}
        </p>
      ) : null}
      <button
        className="w-full rounded-lg bg-store-primary px-3 py-2.5 text-sm font-bold text-store-primary-text hover:opacity-90 disabled:opacity-60"
        disabled={saving}
        onClick={handleSubmit}
        type="button"
      >
        {saving ? 'Saving…' : 'Save and continue'}
      </button>
    </div>
  );
}
