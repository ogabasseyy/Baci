import { CheckCircle2, Pencil } from 'lucide-react';

export function OxygenSignatureReady({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <CheckCircle2
          aria-hidden="true"
          className="size-8 shrink-0 text-emerald-600"
        />
        <div>
          <p className="text-sm font-semibold text-gray-900">Your signature</p>
          <p role="status" className="mt-0.5 text-xs text-emerald-700">
            Signature ready
          </p>
        </div>
      </div>
      <button
        type="button"
        aria-label="Change signature"
        className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        onClick={onReset}
      >
        <Pencil aria-hidden="true" className="size-4" />
        Change
      </button>
    </div>
  );
}
