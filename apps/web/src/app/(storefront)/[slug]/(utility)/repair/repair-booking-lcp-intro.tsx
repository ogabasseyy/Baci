export function RepairBookingLcpIntro() {
  return (
    <section className="relative mb-6 overflow-hidden rounded-2xl border border-store-border/80 bg-store-background-text/[0.035] px-5 py-6 sm:mb-8 sm:px-8 sm:py-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div data-cwv-lcp-fold="" data-repair-booking-lcp-fold="">
            <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-store-primary">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-store-primary"
              />
              Repair booking
            </p>
            <h1
              className="text-3xl font-bold tracking-tight sm:text-4xl"
              data-cwv-lcp-copy="repair"
            >
              Book a Repair Service
            </h1>
          </div>
          <p
            className="mt-3 max-w-xl text-sm leading-6 text-store-background-text/70 sm:text-base"
            data-cwv-lcp-support=""
          >
            Tell us what happened and our team will help with the next step.
          </p>
        </div>
        <div className="flex w-fit items-center gap-3 rounded-xl border border-store-border/70 bg-store-background/60 px-4 py-3">
          <span className="text-2xl font-semibold tabular-nums text-store-primary">
            03
          </span>
          <span className="text-xs leading-5 text-store-background-text/70">
            simple steps
            <br />
            to get started
          </span>
        </div>
      </div>
    </section>
  );
}
