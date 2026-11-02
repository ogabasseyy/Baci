import { ShieldCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

/** Keep the checkout geometry visible while route data streams in. */
export default function CheckoutLoading() {
  return (
    <div
      role="status"
      aria-label="Loading checkout"
      aria-busy="true"
      className="ogabassey-checkout-page min-h-screen bg-gray-50/50 pb-20"
    >
      <div aria-hidden="true">
        <div className="flex h-16 items-center justify-center border-b border-gray-200/50 bg-white">
          <div className="flex items-center gap-2 font-bold text-gray-900">
            <ShieldCheck className="size-4 text-green-600" />
            Secure Checkout
          </div>
        </div>
        <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-3 lg:px-8">
          <div className="space-y-6 lg:col-span-2">
            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-lg font-bold text-gray-900">
                Contact Information
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {['name', 'email', 'phone', 'address'].map((field) => (
                  <div key={field} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ))}
              </div>
            </section>
            {['Delivery Method', 'Payment Method'].map((title) => (
              <section
                key={title}
                className="rounded-2xl border border-gray-100 bg-white px-6 py-4 shadow-sm"
              >
                <h2 className="text-lg font-bold text-gray-500">{title}</h2>
              </section>
            ))}
          </div>
          <aside className="hidden h-fit space-y-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:block">
            <h2 className="text-lg font-bold text-gray-900">Order Summary</h2>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </aside>
        </div>
      </div>
    </div>
  );
}
