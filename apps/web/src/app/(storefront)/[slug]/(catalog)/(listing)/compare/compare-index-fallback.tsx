import { CompareHubIntro } from './compare-hub-intro';

interface CompareIndexFallbackProps {
  hideChrome?: boolean;
  hideIntro?: boolean;
}

export function CompareIndexFallback({
  hideChrome = false,
  hideIntro = false,
}: CompareIndexFallbackProps) {
  if (hideChrome) {
    return (
      <div
        role="status"
        aria-label="Loading compare products"
        aria-live="polite"
        className="sr-only"
      >
        Loading compare products
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Loading compare products"
      aria-live="polite"
      className="block min-h-screen bg-[color-mix(in_srgb,var(--store-background)_94%,var(--store-background-text)_6%)] pb-20 pt-6"
    >
      <div className="mx-auto max-w-[1400px] px-4 md:px-6">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-sm text-store-background-text/55"
        >
          <span>Home</span> <span aria-hidden="true">/</span>{' '}
          <span className="font-medium text-store-background-text">
            Compare products
          </span>
        </nav>
        {hideIntro ? null : <CompareHubIntro />}
      </div>
    </div>
  );
}
