import { Clock3 } from 'lucide-react';
import { OxygenVerificationActivity } from './OxygenVerificationActivity';
import { oxygenButtonClass } from './oxygen-checkout-styles';
export function OxygenAddressProgress({
  submitted,
  delayed = false,
  replacementRequested = false,
  statusUnavailable = false,
  busy = false,
  onCheck,
  onReplace,
}: {
  submitted: boolean;
  delayed?: boolean;
  manualReview?: boolean;
  replacementRequested?: boolean;
  statusUnavailable?: boolean;
  busy?: boolean;
  onCheck?: () => Promise<void>;
  onReplace?: () => void;
}) {
  return (
    <div
      role="status"
      className="mx-auto grid max-w-md justify-items-center gap-5 py-8 text-center"
    >
      {delayed ? (
        <span className="flex size-16 items-center justify-center rounded-3xl bg-amber-50 text-amber-700">
          <Clock3 className="size-7" aria-hidden="true" />
        </span>
      ) : (
        <OxygenVerificationActivity />
      )}
      <div className="space-y-2">
        <h3 className="text-xl font-bold text-gray-900">
          {delayed && statusUnavailable
            ? 'We couldn’t check your address status'
            : submitted
              ? 'Oxygen is reviewing your address'
              : 'Sending your address securely'}
        </h3>
        <p className="text-sm leading-relaxed text-gray-500">
          {delayed && statusUnavailable
            ? 'We couldn’t get the latest update from Oxygen. Your progress is saved; please check again later.'
            : submitted
              ? 'Oxygen is currently reviewing your address details.'
              : 'We’re sending the home address and proof you provided. There’s no need to enter them again.'}
        </p>
      </div>
      {submitted && replacementRequested && onReplace && (
        <button
          type="button"
          className={oxygenButtonClass}
          disabled={busy}
          onClick={onReplace}
        >
          Upload another proof
        </button>
      )}
      {submitted && onCheck && (
        <button
          type="button"
          className={oxygenButtonClass}
          disabled={busy}
          onClick={() => void onCheck()}
        >
          {busy ? 'Checking…' : 'Check for an update'}
        </button>
      )}
      <p className="text-xs text-gray-400">
        Your application stays saved. You can close this window and return
        later.
      </p>
    </div>
  );
}
