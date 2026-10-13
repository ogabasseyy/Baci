'use client';

import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface GoogleAdsAccount {
  customerId: string;
  selected: boolean;
}

interface GoogleAdsAccountListProps {
  accounts: GoogleAdsAccount[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  onSelect: (customerId: string) => void;
  selectedCustomerId: string | null;
}

function maskCustomerId(customerId: string): string {
  const normalized = customerId.replaceAll('-', '');
  return `Google Ads account ••••${normalized.slice(-4)}`;
}

export function GoogleAdsAccountList({
  accounts,
  isSaving,
  onCancel,
  onSave,
  onSelect,
  selectedCustomerId,
}: GoogleAdsAccountListProps) {
  return (
    <div
      aria-label="Google Ads accounts"
      className="space-y-2"
      role="radiogroup"
    >
      {accounts.map((account) => {
        const selected = account.customerId === selectedCustomerId;
        return (
          <label
            className={cn(
              'flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors focus-within:outline-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
              selected
                ? 'border-primary bg-primary/10'
                : 'border-border hover:bg-muted/50'
            )}
            key={account.customerId}
          >
            <input
              checked={selected}
              className="sr-only"
              name="google-ads-account"
              onChange={() => onSelect(account.customerId)}
              type="radio"
              value={account.customerId}
            />
            <span>{maskCustomerId(account.customerId)}</span>
            {selected && <Check className="size-4 text-primary" />}
          </label>
        );
      })}
      <Button
        className="gap-2"
        disabled={isSaving || selectedCustomerId === null}
        onClick={onSave}
        size="sm"
        type="button"
      >
        {isSaving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Check className="size-4" />
        )}
        Save account and sync spend
      </Button>
      <Button
        disabled={isSaving}
        onClick={onCancel}
        size="sm"
        type="button"
        variant="ghost"
      >
        Cancel
      </Button>
    </div>
  );
}
