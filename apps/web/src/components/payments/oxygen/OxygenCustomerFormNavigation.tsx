import { OxygenLoadingButton } from './OxygenLoadingButton';

export function OxygenCustomerFormNavigation({
  step,
  canGoBack,
  busy,
  continuing,
  disabled,
  onBack,
  continueLabel,
}: {
  step: number;
  canGoBack?: boolean;
  busy: boolean;
  continuing: 'saving' | 'starting' | null;
  disabled: boolean;
  onBack(): void;
  continueLabel?: string;
}) {
  const showBack = canGoBack ?? step > 0;
  return (
    <div className="flex items-center justify-between gap-3 pt-1">
      {showBack ? (
        <button
          type="button"
          disabled={busy || Boolean(continuing)}
          className="min-h-11 rounded-xl border border-gray-200 px-5 text-sm font-semibold text-gray-600"
          onClick={onBack}
        >
          Back
        </button>
      ) : (
        <span className="hidden sm:block" />
      )}
      <OxygenLoadingButton
        className="flex-1 sm:flex-none"
        loading={Boolean(continuing)}
        pendingLabel={
          continuing === 'saving' ? 'Saving details…' : 'Starting verification…'
        }
        disabled={disabled}
        type="submit"
      >
        {continueLabel ??
          (step === 0
            ? 'Continue to bank details'
            : step === 1
              ? 'Continue to income details'
              : 'Continue verification')}
      </OxygenLoadingButton>
    </div>
  );
}
