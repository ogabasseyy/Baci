import { COUNTER_NEGOTIATION_DISCOUNT_STEPS } from '@baci/shared/lib';
import { CheckCircle2, HandCoins, Loader2, Upload } from 'lucide-react';
import type { NegotiationStatus } from './use-negotiation-modal-controller';

interface NegotiationModalStatusContentProps {
  attemptCount: number;
  counterOffer: number | null;
  message: string;
  onAcceptCounter: () => void;
  onClose: () => void;
  onNegotiateAgain: () => void;
  onShowUpload: () => void;
  status: NegotiationStatus;
}

export function NegotiationModalStatusContent({
  attemptCount,
  counterOffer,
  message,
  onAcceptCounter,
  onClose,
  onNegotiateAgain,
  onShowUpload,
  status,
}: NegotiationModalStatusContentProps) {
  if (status === 'processing') {
    return (
      <div
        aria-live="polite"
        className="flex flex-col items-center justify-center py-4"
        role="status"
      >
        <Loader2
          size={40}
          aria-hidden="true"
          className="text-[var(--store-primary)] animate-spin mb-4"
        />
        <p className="font-medium text-[hsl(var(--muted-foreground))]">
          Reviewing your offer…
        </p>
        <p className="text-xs text-[hsl(var(--muted-foreground))]/80 mt-2">
          Checking with sales manager
        </p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div
        aria-live="polite"
        className="flex flex-col items-center justify-center py-2 text-center animate-in fade-in slide-in-from-bottom-2"
        role="status"
      >
        <div className="size-12 bg-[var(--store-primary)]/10 rounded-full flex items-center justify-center mb-3">
          <CheckCircle2 size={28} className="text-[var(--store-primary)]" />
        </div>
        <h4 className="text-xl font-bold text-[hsl(var(--card-foreground))] mb-1">
          Offer Accepted!
        </h4>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">
          {message || 'Price has been updated in your cart.'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="bg-[hsl(var(--foreground))] text-[hsl(var(--background))] px-6 py-2 rounded-lg font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Done
        </button>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div
        aria-live="polite"
        className="flex flex-col items-center justify-center py-2 text-center animate-in shake duration-300"
        role="status"
      >
        <div className="size-12 bg-[var(--store-primary)]/10 rounded-full flex items-center justify-center mb-3">
          <HandCoins size={28} className="text-[var(--store-primary)]" />
        </div>
        <h4 className="text-lg font-bold text-[hsl(var(--card-foreground))] mb-1">
          Counter Offer
        </h4>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-2">
          {message}
        </p>
        {counterOffer ? (
          <div className="text-2xl font-bold text-[hsl(var(--card-foreground))] mb-6 bg-[hsl(var(--muted))] px-4 py-2 rounded-lg border border-[hsl(var(--border))]">
            ₦{counterOffer.toLocaleString()}
          </div>
        ) : null}
        <div className="flex flex-col w-full gap-2">
          {counterOffer ? (
            <button
              type="button"
              onClick={onAcceptCounter}
              className="w-full bg-[var(--store-primary)] hover:bg-[var(--store-primary)]/90 text-[var(--store-primary-text)] font-bold py-3 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={18} />
              Accept ₦{counterOffer.toLocaleString()}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onNegotiateAgain}
            className="w-full bg-[hsl(var(--muted))] text-[hsl(var(--card-foreground))] font-bold py-3 rounded-xl hover:bg-[var(--store-primary)]/10 transition-colors"
          >
            Negotiate Again
          </button>
          {attemptCount >= COUNTER_NEGOTIATION_DISCOUNT_STEPS.length ? (
            <button
              type="button"
              onClick={onShowUpload}
              className="w-full bg-[var(--store-primary)]/5 text-[var(--store-primary)] font-bold py-3 rounded-xl hover:bg-[var(--store-primary)]/10 transition-colors border border-[var(--store-primary)]/20 flex items-center justify-center gap-2"
            >
              <Upload size={18} />I Saw It Cheaper
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (status === 'final' || status === 'submitted') {
    const submitted = status === 'submitted';
    return (
      <div
        aria-live="polite"
        className="flex flex-col items-center justify-center py-4 text-center animate-in fade-in slide-in-from-bottom-2"
        role="status"
      >
        <div className="size-12 bg-[var(--store-primary)]/10 rounded-full flex items-center justify-center mb-3">
          {submitted ? (
            <CheckCircle2 size={28} className="text-[var(--store-primary)]" />
          ) : (
            <HandCoins size={28} className="text-[var(--store-primary)]" />
          )}
        </div>
        <h4 className="text-lg font-bold text-[hsl(var(--card-foreground))] mb-1">
          {submitted ? 'Request Sent' : 'Final Price'}
        </h4>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mb-6">
          {message}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="bg-[hsl(var(--foreground))] text-[hsl(var(--background))] px-8 py-2 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity"
        >
          Got it
        </button>
      </div>
    );
  }

  return null;
}
