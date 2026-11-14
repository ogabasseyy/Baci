'use client';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { OxygenResidentialForm } from './OxygenResidentialForm';
import type { SubmitOxygenForm } from './OxygenVerificationForms';

export function OxygenQueuedAddressRecovery({
  snapshot,
  busy,
  error,
  refresh,
  submit,
}: {
  snapshot: OxygenRuntimeSnapshot;
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  submit: SubmitOxygenForm;
}) {
  return (
    <section className="px-6 pb-6" aria-label="Continue address verification">
      <p className="py-4 text-sm text-gray-600">
        Your previous address submission did not start. Select your proof again
        and confirm your address to continue.
      </p>
      {error && (
        <div role="alert" className="space-y-2 text-sm text-red-700">
          <p>
            We couldn’t continue your address submission. Check your saved
            status before trying again.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className="font-semibold underline"
          >
            Check saved status
          </button>
        </div>
      )}
      <OxygenResidentialForm
        workflowId={snapshot.workflowId}
        busy={busy}
        submit={submit}
      />
    </section>
  );
}
