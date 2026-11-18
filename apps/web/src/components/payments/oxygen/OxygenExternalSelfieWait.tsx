export function OxygenExternalSelfieWait({
  onCheck,
  onBack,
}: {
  onCheck(): void;
  onBack(): void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-8 text-center text-gray-900">
      <h3 className="text-lg font-semibold">
        Complete your selfie with Oxygen
      </h3>
      <p className="max-w-sm text-sm leading-6 text-gray-600">
        Finish verification in the new tab, then return to this tab. We’ll check
        with Oxygen and continue when your selfie is confirmed.
      </p>
      <button
        type="button"
        onClick={onCheck}
        className="min-h-11 rounded-lg bg-store-primary px-5 py-2 text-sm font-semibold text-store-primary-text"
      >
        Check selfie status
      </button>
      <button
        type="button"
        onClick={onBack}
        className="min-h-11 px-3 text-sm font-medium text-gray-600 underline"
      >
        Return to camera options
      </button>
    </div>
  );
}
