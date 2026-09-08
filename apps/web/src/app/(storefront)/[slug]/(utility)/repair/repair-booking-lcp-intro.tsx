export function RepairBookingLcpIntro() {
  return (
    <>
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-4">Book a Repair Service</h1>
        <p className="text-store-background-text/70 text-lg">
          Have a broken device? Fill out the form below and we'll get it fixed
          for you.
        </p>
      </div>

      <section className="mb-8 rounded-xl border border-store-border bg-store-background-text/5 p-5 text-store-background-text shadow-sm">
        <h2 className="text-xl font-semibold">Before you book a repair</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-store-background-text/70 sm:text-base sm:leading-7">
          <p>
            Use this repair request to describe the device model, visible
            damage, fault symptoms and any recent repair attempts. Clear details
            help our technicians estimate the right diagnosis path before you
            bring in or dispatch the device.
          </p>
          <p>
            For phones, laptops, tablets, consoles and accessories, back up
            important data where possible, remove passcodes only when support
            asks for them, and keep proof of purchase or warranty information
            available. Final pricing depends on inspection, parts availability
            and the confirmed fault.
          </p>
        </div>
      </section>
    </>
  );
}
