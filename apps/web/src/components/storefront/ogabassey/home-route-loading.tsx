export function HomeRouteLoading() {
  return (
    <div
      role="status"
      aria-label="Loading storefront homepage"
      aria-live="polite"
      className="block"
    >
      <div className="min-h-screen bg-background" aria-hidden="true" />
    </div>
  );
}
