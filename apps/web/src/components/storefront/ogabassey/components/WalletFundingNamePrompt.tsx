'use client';

import { useState } from 'react';
import { WALLET_FUNDING_COPY } from './wallet-funding-copy';

interface WalletFundingNamePromptProps {
  initialFirstName?: string | null;
  initialLastName?: string | null;
  onSubmit: (
    firstName: string,
    lastName: string
  ) => Promise<{ success: boolean; error?: string }>;
}

export function WalletFundingNamePrompt({
  initialFirstName,
  initialLastName,
  onSubmit,
}: WalletFundingNamePromptProps) {
  const [firstName, setFirstName] = useState(initialFirstName?.trim() ?? '');
  const [lastName, setLastName] = useState(initialLastName?.trim() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    const normalizedFirstName = firstName.trim();
    const normalizedLastName = lastName.trim();
    if (!normalizedFirstName || !normalizedLastName) {
      setError(WALLET_FUNDING_COPY.invalidName);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const result = await onSubmit(normalizedFirstName, normalizedLastName);
      if (!result.success) {
        setError(result.error ?? WALLET_FUNDING_COPY.nameSaveFailed);
      }
    } catch {
      setError(WALLET_FUNDING_COPY.nameSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-store-background-text/70">
        Add your first and last name so we can create your wallet bank-transfer
        account number.
      </p>
      <label
        className="block text-xs font-semibold text-store-background-text/80"
        htmlFor="wallet-funding-first-name"
      >
        First name
      </label>
      <input
        aria-label="First name"
        autoComplete="given-name"
        className="w-full rounded-xl border border-store-border bg-store-secondary px-3 py-2.5 text-sm text-store-background-text outline-none focus:border-store-primary focus:ring-1 focus:ring-store-primary"
        disabled={saving}
        id="wallet-funding-first-name"
        onChange={(event) => {
          setFirstName(event.target.value);
          if (error) setError(null);
        }}
        type="text"
        value={firstName}
      />
      <label
        className="block text-xs font-semibold text-store-background-text/80"
        htmlFor="wallet-funding-last-name"
      >
        Last name
      </label>
      <input
        aria-label="Last name"
        autoComplete="family-name"
        className="w-full rounded-xl border border-store-border bg-store-secondary px-3 py-2.5 text-sm text-store-background-text outline-none focus:border-store-primary focus:ring-1 focus:ring-store-primary"
        disabled={saving}
        id="wallet-funding-last-name"
        onChange={(event) => {
          setLastName(event.target.value);
          if (error) setError(null);
        }}
        type="text"
        value={lastName}
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
