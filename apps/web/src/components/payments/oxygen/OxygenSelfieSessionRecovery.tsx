import { OxygenLoadingButton } from './OxygenLoadingButton';
export function OxygenSelfieSessionRecovery({
  renewing,
  error,
  onRetry,
}: {
  renewing: boolean;
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="grid flex-1 content-center justify-items-center gap-5 p-6 text-center">
      <h3 className="text-xl font-bold text-gray-900">
        {renewing
          ? 'Refreshing your verification session…'
          : 'Your verification session expired'}
      </h3>
      <p className="text-sm text-gray-500">
        {renewing
          ? 'Your camera will reopen shortly. Your progress is saved.'
          : onRetry
            ? 'Your progress is saved. Try again to continue your selfie.'
            : 'Your progress is saved. Return to your application to continue.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-store-primary">
          {error}
        </p>
      )}
      {onRetry && (
        <OxygenLoadingButton
          type="button"
          loading={renewing}
          pendingLabel="Refreshing session…"
          onClick={onRetry}
          className="w-full max-w-sm rounded-xl bg-store-primary px-4 py-3 font-semibold text-store-primary-text"
        >
          Try again
        </OxygenLoadingButton>
      )}
    </div>
  );
}
