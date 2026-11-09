import { Recycle } from 'lucide-react';

export function RepairsRecyclingSection() {
  return (
    <section className="bg-store-secondary rounded-3xl p-8 md:p-12 text-center border border-store-border">
      <Recycle className="mx-auto mb-6" size={32} />
      <h2 className="text-2xl md:text-3xl font-bold text-store-background-text mb-4">
        Beyond Repair? Recycle Responsibly.
      </h2>
      <p className="text-store-background-text/65 max-w-2xl mx-auto">
        Contact support before bringing an end-of-life device to the store.
        Confirm whether collection is available, which devices are accepted and
        how disposal is handled. Remove personal data before handing over a device.
      </p>
    </section>
  );
}
