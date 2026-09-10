import { Skeleton } from '@/components/ui/skeleton';

interface BlogListingFallbackProps {
  includeFeaturedSkeleton?: boolean;
}

export function BlogListingFallback({
  includeFeaturedSkeleton = true,
}: BlogListingFallbackProps) {
  return (
    <div
      role="status"
      aria-label="Loading blog posts"
      aria-live="polite"
      className="block min-h-screen bg-background pb-20 pt-4"
    >
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 pt-8 md:pt-12">
        {includeFeaturedSkeleton ? (
          <section
            aria-label="Loading featured story"
            className="mb-12 overflow-hidden rounded-4xl border border-border bg-card p-6 shadow-sm md:p-8"
          >
            <Skeleton
              className="h-[320px] w-full rounded-3xl bg-muted md:h-[420px]"
              shimmer
            />
            <div className="mt-8 space-y-4">
              <Skeleton className="h-4 w-28 bg-muted" shimmer />
              <Skeleton className="h-10 w-full max-w-3xl bg-muted" shimmer />
              <Skeleton className="h-5 w-full max-w-2xl bg-muted" shimmer />
            </div>
          </section>
        ) : null}

        <div className="mb-10 flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: Static fallback pills
              key={index}
              className="h-10 w-28 shrink-0 rounded-full bg-muted"
              shimmer
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Static fallback cards
              key={index}
              className="overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm"
            >
              <Skeleton
                className="h-64 w-full rounded-[1.25rem] bg-muted"
                shimmer
              />
              <div className="mt-5 space-y-3">
                <Skeleton className="h-3 w-1/2 bg-muted" shimmer />
                <Skeleton className="h-7 w-full bg-muted" shimmer />
                <Skeleton className="h-7 w-4/5 bg-muted" shimmer />
                <Skeleton className="h-4 w-full bg-muted" shimmer />
                <Skeleton className="h-4 w-2/3 bg-muted" shimmer />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
