'use client';

import { RepairBookingWizard } from '@/components/storefront/RepairBookingWizard';
import '@/app/(storefront)/storefront-core.css';
import '@/app/(storefront)/storefront-full.css';

export default function RepairFixturePage() {
  return (
    <main className="container mx-auto px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold">Repair booking simulation</h1>
      <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        Test demo only: the address suggestions, GIG pickup quote, and payment
        handoff are simulated. This page does not contact GIG or create a
        booking.
      </p>
      <RepairBookingWizard
        merchantId="11111111-1111-4111-8111-111111111111"
        merchantName="Local repair fixture"
        merchantSlug="ogabassey"
        repairsCatalogEnabled
      />
    </main>
  );
}
