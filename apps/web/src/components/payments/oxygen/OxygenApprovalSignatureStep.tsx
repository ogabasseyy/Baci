import type { Ref } from 'react';
import styles from './OxygenApprovalCode.module.css';
import { OxygenSignature, type OxygenSignatureHandle } from './OxygenSignature';

export function OxygenApprovalSignatureStep({
  signature,
  capture,
  nextPaymentDate,
  accepted,
  disabled,
  saving,
  sending,
  error,
  onSignature,
  onAccept,
  onContinue,
}: {
  signature?: File;
  capture: Ref<OxygenSignatureHandle>;
  nextPaymentDate?: string;
  accepted: boolean;
  disabled: boolean;
  saving: boolean;
  sending: boolean;
  error: string;
  onSignature: (file: File | undefined) => void;
  onAccept: (accepted: boolean) => void;
  onContinue: () => void;
}) {
  return (
    <section
      className={styles.confirmation}
      aria-label="Signature and acceptance"
    >
      <OxygenSignature
        embedded
        saveOnAccept={capture}
        initialSignature={signature}
        disabled={disabled}
        onChange={onSignature}
      />
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm leading-relaxed">
        <input
          type="checkbox"
          className="size-4 shrink-0 accent-red-600"
          disabled={disabled || !nextPaymentDate}
          checked={accepted}
          onChange={(event) => onAccept(event.currentTarget.checked)}
        />
        <span className="text-red-700">
          {nextPaymentDate ? (
            <>
              I accept this payment plan and understand my next payment is due
              on <strong>{nextPaymentDate}</strong>.
            </>
          ) : (
            'Your next payment date will appear when Oxygen confirms your schedule.'
          )}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        className="flex min-h-11 items-center justify-center rounded-xl bg-[var(--store-primary)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        disabled={disabled || !accepted || !nextPaymentDate}
        aria-busy={sending || saving}
        onClick={onContinue}
      >
        {sending ? 'Sending code…' : saving ? 'Saving signature…' : 'Continue'}
      </button>
    </section>
  );
}
