export function RepairBookingPrepSection() {
  return (
    <section className="mb-6 flex items-start gap-3 rounded-xl border border-store-border/70 bg-store-background-text/[0.035] px-4 py-3 text-left">
      <span
        aria-hidden="true"
        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-store-primary"
      />
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-store-background-text">
          A quick note before you start
        </h2>
        <p className="text-xs leading-5 text-store-background-text/70 sm:text-sm">
          Include the model, symptoms and any recent repair attempts. Final
          pricing is confirmed after inspection and parts checks.
        </p>
      </div>
    </section>
  );
}
