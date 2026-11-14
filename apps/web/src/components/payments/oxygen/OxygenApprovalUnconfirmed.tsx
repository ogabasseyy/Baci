import { Clock3 } from 'lucide-react';

export function OxygenApprovalUnconfirmed({
  busy,
  refresh,
}: {
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  return (
    <section
      data-oxygen-approval-step="code"
      aria-label="Approval confirmation pending"
      className="grid gap-4 rounded-2xl border border-amber-100 bg-gradient-to-b from-amber-50/50 to-white p-5 text-center"
    >
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-amber-50 text-amber-700">
        <Clock3 aria-hidden="true" className="size-5" />
      </span>
      <h3 className="text-lg font-semibold text-gray-900">
        We couldn’t confirm your approval
      </h3>
      <p className="text-sm leading-relaxed text-gray-600">
        Oxygen hasn’t confirmed this step yet. Your payment plan is saved.
        Please don’t submit another code while we check.
      </p>
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--store-primary)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        onClick={() => void refresh()}
      >
        {busy ? 'Checking status…' : 'Check for an update'}
      </button>
      <p className="text-xs leading-relaxed text-gray-500">
        You can close this window and return later.
      </p>
    </section>
  );
}
