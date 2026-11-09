export function BlogPostBodyFallback() {
  return (
    <div
      aria-hidden="true"
      data-testid="blog-post-body-fallback"
      className="space-y-4 content-auto [contain-intrinsic-size:auto_1600px]"
    >
      <div className="h-4 w-32 rounded bg-muted/60" />
      <div className="h-4 w-full rounded bg-muted/40" />
      <div className="h-4 w-full rounded bg-muted/40" />
      <div className="h-4 w-5/6 rounded bg-muted/40" />
      <div className="h-48 rounded-2xl bg-muted/50" />
    </div>
  );
}
