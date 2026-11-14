import { OxygenVerificationActivity } from './OxygenVerificationActivity';

/** A frame success message is a hint; the server must still confirm identity. */
export function OxygenSelfieLoading({ confirming }: { confirming: boolean }) {
  const title = confirming
    ? 'Confirming your selfie'
    : 'Opening face verification';
  return (
    <div
      role="status"
      aria-label={title}
      aria-busy="true"
      className="absolute inset-0 z-10 grid place-content-center justify-items-center gap-5 bg-white px-6 text-center"
    >
      <OxygenVerificationActivity />
      <div className="max-w-xs space-y-2">
        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
        <p className="text-sm leading-6 text-gray-500">
          {confirming
            ? 'We’re waiting for Oxygen to confirm your selfie, then we’ll continue automatically.'
            : 'Getting Oxygen’s secure camera check ready for you.'}
        </p>
      </div>
    </div>
  );
}
