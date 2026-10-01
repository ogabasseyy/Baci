import { Loader2 } from 'lucide-react';
import { WALLET_FUNDING_COPY } from './wallet-funding-copy';

interface WalletFundingConsentProps {
  creating: boolean;
  merchantSlug: string | undefined;
  needsPhone: boolean;
  onCreate: () => void;
  showUnavailable: boolean;
}

export function WalletFundingConsent({
  creating,
  merchantSlug,
  needsPhone,
  onCreate,
  showUnavailable,
}: WalletFundingConsentProps) {
  return (
    <>
      <p className="text-xs text-store-background-text/60">
        {showUnavailable
          ? WALLET_FUNDING_COPY.unavailable
          : WALLET_FUNDING_COPY.consentBlurb}
      </p>
      <p className="text-xs font-medium text-store-primary">
        {WALLET_FUNDING_COPY.feeNote}
      </p>
      <button
        type="button"
        disabled={creating || needsPhone || !merchantSlug}
        onClick={onCreate}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-store-primary px-3 py-2.5 text-sm font-bold text-store-on-primary hover:opacity-90 disabled:opacity-60"
      >
        {creating ? (
          <>
            <Loader2 className="animate-spin" size={14} />
            {WALLET_FUNDING_COPY.creating}
          </>
        ) : (
          WALLET_FUNDING_COPY.consentCta
        )}
      </button>
    </>
  );
}
