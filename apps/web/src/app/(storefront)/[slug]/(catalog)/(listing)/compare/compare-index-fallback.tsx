import Link from 'next/link';
import { asRoute } from '@/lib/routes';
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
        aria-labelledby="compare-loading-status"
        aria-live="polite"
        aria-busy="true"
        className="space-y-6 pt-4"
      >
        <span id="compare-loading-status" className="sr-only">
          Loading compare products
        </span>
        <div aria-hidden="true" className="space-y-6">
          {[1, 2].map((idx) => (
            <div
              key={idx}
              className="rounded-3xl border border-store-background-text/10 bg-store-background p-5 shadow-xs md:p-6 animate-pulse"
            >
              <div className="flex items-center justify-between border-b border-store-background-text/5 pb-4">
                <div className="space-y-2">
                  <div className="h-6 w-36 rounded-md bg-store-background-text/10" />
                  <div className="h-4 w-24 rounded-md bg-store-background-text/5" />
                </div>
                <div className="h-4 w-28 rounded-md bg-store-background-text/10" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((cardIdx) => (
                  <div
                    key={cardIdx}
                    className="h-24 rounded-2xl border border-store-background-text/5 bg-store-background-text/5"
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
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
        <div data-compare-hub-chrome="">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-2 text-sm text-store-background-text/55"
          >
            <Link
              className="transition-colors hover:text-store-primary"
              href={asRoute('.')}
              prefetch={false}
            >
              Home
            </Link>{' '}
            <span aria-hidden="true">/</span>{' '}
            <span className="font-medium text-store-background-text">
              Compare products
            </span>
          </nav>
          {hideIntro ? null : <CompareHubIntro />}
        </div>
      </div>
    </div>
  );
}
