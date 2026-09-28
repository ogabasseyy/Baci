'use client';

// Client boundary justification: retrying a failed search must re-execute the
// server component, which needs the useRouter().refresh() client API. A Link
// to the identical URL would reuse the cached route and leave the error panel
// in place.

import { useRouter } from 'next/navigation';

export function SearchPageRetryButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="rounded-md bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition hover:opacity-90"
    >
      Try again
    </button>
  );
}
