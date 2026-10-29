/** Location confirmation is a GIG requirement, separate from merchant rates. */
export function GiglLocationNotice() {
  return (
    <div
      role="status"
      className="mt-4 rounded-xl border border-store-primary/20 bg-store-primary/5 p-4 text-sm text-store-background-text"
    >
      <p className="font-bold">Confirm location for GIG delivery</p>
      <p className="mt-1 text-store-background-text/75">
        Choose a matching address suggestion to confirm the location. If
        suggestions are unavailable, GIG delivery cannot be confirmed now.
        Choose another available delivery method or try again later.
      </p>
    </div>
  );
}
