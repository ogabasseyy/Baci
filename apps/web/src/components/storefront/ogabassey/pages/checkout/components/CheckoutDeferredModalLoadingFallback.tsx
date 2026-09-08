/** Blocking scrim while a deferred checkout dialog chunk loads. */
export function CheckoutDeferredModalLoadingFallback({
  label = 'Loading dialog…',
}: {
  label?: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-label="Loading checkout dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--store-overlay)]/50"
    >
      <span
        role="status"
        className="rounded-xl bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-lg"
      >
        {label}
      </span>
    </div>
  );
}
