import { BlogPostBodyFallback } from './BlogPostBodyFallback';

export function BlogPostPageFallback() {
  return (
    <div className="min-h-screen bg-background">
      {/* Breadcrumb skeleton */}
      <div className="border-b border-border bg-background">
        <div className="container mx-auto px-4 py-4">
          <div className="h-4 w-28 rounded bg-muted/40" />
        </div>
      </div>

      <main className="container mx-auto px-4 py-8">
        <article className="max-w-6xl mx-auto bg-card text-card-foreground rounded-3xl p-6 md:p-10 md:px-12 shadow-sm border border-border overflow-hidden">
          {/* Featured image skeleton — layout-identical to the real hero
              container so replacing it causes no CLS. */}
          <div className="aspect-video rounded-2xl overflow-hidden mb-8 relative bg-muted">
            <div className="absolute inset-0 animate-pulse bg-muted/30" />
          </div>

          {/* Header skeleton: category + title + author row */}
          <div className="space-y-4 mb-8">
            <div className="h-5 w-20 rounded-full bg-muted/40" />
            <div className="h-8 w-3/4 rounded bg-muted/50" />
            <div className="h-8 w-1/2 rounded bg-muted/40" />
            <div className="flex items-center gap-3 pt-2">
              <div className="size-10 rounded-full bg-muted/40" />
              <div className="space-y-1.5">
                <div className="h-3.5 w-24 rounded bg-muted/40" />
                <div className="h-3 w-32 rounded bg-muted/30" />
              </div>
            </div>
          </div>

          {/* Body skeleton */}
          <BlogPostBodyFallback />
        </article>
      </main>
    </div>
  );
}
