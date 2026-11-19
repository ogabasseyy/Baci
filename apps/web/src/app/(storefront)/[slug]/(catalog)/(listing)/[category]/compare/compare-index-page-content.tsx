import Link from 'next/link';
import { asRoute } from '@/lib/routes';
import type { CompareLinkGraphEntry } from '@/lib/storefront-link-modules/compare-link-graph';
import { resolveStorefrontPathHref } from '@/lib/storefront-path-prefix';

interface CompareIndexPageContentProps {
  categoryName: string;
  categoryHref: string;
  compareLinks: CompareLinkGraphEntry[];
  merchantName: string;
  pathPrefix: string;
}

export function CompareIndexPageContent({
  categoryName,
  categoryHref,
  compareLinks,
  merchantName,
  pathPrefix,
}: CompareIndexPageContentProps) {
  return (
    <main className="mx-auto max-w-6xl bg-store-background px-4 py-10 text-store-background-text sm:px-6 lg:px-8">
      <header className="max-w-3xl space-y-3">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-store-primary/20 bg-store-primary/10 px-3 py-1 text-xs font-semibold text-store-primary">
          <span>{categoryName} Comparison Hub</span>
        </div>
        <h1
          className="text-3xl font-bold tracking-tight md:text-4xl"
          data-cwv-lcp-copy="compare"
        >
          {categoryName} comparisons
        </h1>
        <p
          className="text-base leading-7 text-store-background-text/65 sm:text-lg"
          data-cwv-lcp-copy="authority-hub"
        >
          Compare prices, specs, condition, warranty, and buying fit across{' '}
          {categoryName.toLowerCase()} available from {merchantName}.
        </p>
        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs font-medium text-store-background-text/75 sm:gap-6">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-store-primary">✓</span>
            <span>Side-by-side specs</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-store-primary">✓</span>
            <span>Verified Nigeria pricing</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-store-primary">✓</span>
            <span>Unbiased buying fit</span>
          </div>
        </div>
      </header>

      {compareLinks.length > 0 ? (
        <section
          aria-labelledby="available-comparisons-heading"
          className="mt-8 grid gap-4 md:grid-cols-2"
        >
          <h2 id="available-comparisons-heading" className="sr-only">
            Available {categoryName} comparisons
          </h2>
          {compareLinks.map((link) => (
            <article
              key={link.href}
              className="group relative flex flex-col justify-between rounded-2xl border border-store-background-text/10 bg-store-background p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-store-primary/40 hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-store-primary">
                    <Link
                      className="transition-colors group-hover:underline after:absolute after:inset-0"
                      href={asRoute(
                        resolveStorefrontPathHref(pathPrefix, link.href)
                      )}
                      prefetch={false}
                    >
                      {link.label}
                    </Link>
                  </h3>
                  <span className="inline-flex shrink-0 items-center justify-center rounded-md bg-store-primary/10 px-2 py-0.5 text-[11px] font-bold text-store-primary">
                    VS
                  </span>
                </div>
                <p className="mt-2 text-sm text-store-background-text/60">
                  {link.description}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-store-background-text/5 pt-3 text-xs text-store-background-text/60">
                <span className="font-medium text-store-primary">
                  Compare specs & prices →
                </span>
                <span className="text-[11px] text-store-background-text/40">
                  Side-by-side
                </span>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="mt-8 rounded-2xl border border-store-background-text/10 bg-store-background p-8 text-center shadow-xs">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
            <span aria-hidden="true" className="text-xl font-bold">
              ⇌
            </span>
          </div>
          <p className="text-sm font-medium text-store-background-text/65">
            No comparison guides are ready for this category yet.
          </p>
          <Link
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-store-primary px-4 py-2 text-sm font-semibold text-store-primary-text transition-opacity hover:opacity-90"
            href={asRoute(resolveStorefrontPathHref(pathPrefix, categoryHref))}
            prefetch={false}
          >
            Browse {categoryName}
          </Link>
        </section>
      )}
    </main>
  );
}
