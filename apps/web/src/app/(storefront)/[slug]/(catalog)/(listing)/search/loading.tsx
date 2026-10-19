const SKELETON_CARDS = [
  'search-loading-card-1',
  'search-loading-card-2',
  'search-loading-card-3',
  'search-loading-card-4',
  'search-loading-card-5',
  'search-loading-card-6',
  'search-loading-card-7',
  'search-loading-card-8',
];

export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading search results"
      aria-live="polite"
      className="block min-h-screen bg-[color-mix(in_srgb,var(--store-background,#ffffff)_94%,var(--store-background-text,#111827)_6%)] pb-20 pt-6"
    >
      <div className="mx-auto max-w-[1400px] px-4 md:px-6">
        <div className="mt-6 space-y-2">
          <div className="h-9 w-64 animate-pulse rounded-lg bg-store-background-text/10" />
          <div className="h-5 w-96 max-w-full animate-pulse rounded bg-store-background-text/10" />
        </div>
        <div className="mt-6 h-11 w-full max-w-xl animate-pulse rounded-xl bg-store-background-text/10" />
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {SKELETON_CARDS.map((key) => (
            <div
              key={key}
              className="h-64 animate-pulse rounded-2xl bg-store-background-text/10"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
