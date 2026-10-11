'use client';

export function RouteOfferMissingNotice() {
  return (
    <p
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
    >
      This offer is no longer available. It may have been removed or sold —
      choose a condition to continue.
    </p>
  );
}
