import { CompareHubIntro } from './compare-hub-intro';

export function CompareIndexFallback() {
  return (
    <div
      role="status"
      aria-label="Loading compare products"
      aria-live="polite"
      className="block min-h-screen bg-[color-mix(in_srgb,var(--store-background)_94%,var(--store-background-text)_6%)] pb-20 pt-6"
    >
      <div className="mx-auto max-w-[1400px] px-4 md:px-6">
        <CompareHubIntro />
      </div>
    </div>
  );
}
