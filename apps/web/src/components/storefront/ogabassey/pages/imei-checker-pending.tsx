import { Clock3, Loader2 } from 'lucide-react';

export function ImeiCheckerPending({
  paused,
  canResume = true,
}: {
  paused: boolean;
  canResume?: boolean;
}) {
  return (
    <div
      aria-live="polite"
      className="mt-4 flex items-start gap-3 rounded-2xl border border-[var(--store-primary)]/20 bg-[var(--store-primary)]/5 p-4 text-sm text-gray-700"
      role="status"
    >
      {paused ? (
        <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      ) : (
        <Loader2
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 animate-spin"
        />
      )}
      <div>
        <p className="font-semibold text-gray-900">
          {paused ? 'Your check is still processing' : "We're checking"}
        </p>
        <p className="mt-1">
          {!canResume
            ? `${paused ? '' : 'This is usually under a minute. '}Keep this page open until your check finishes so you can receive the result here.`
            : paused
              ? "You can close this page and check back later. We'll keep processing it safely."
              : 'This is usually under a minute. You can leave this page and return without paying again.'}
        </p>
      </div>
    </div>
  );
}
