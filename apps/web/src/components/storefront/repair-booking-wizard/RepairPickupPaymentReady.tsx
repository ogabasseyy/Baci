import { CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RepairPickupPaymentReadyProps {
  amount: number;
  authorizationUrl: string;
  ticketNumber: number;
}

export function RepairPickupPaymentReady({
  amount,
  authorizationUrl,
  ticketNumber,
}: RepairPickupPaymentReadyProps) {
  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center text-store-background-text">
      <div className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-store-primary/10 text-store-primary">
        <CreditCard className="size-10" aria-hidden="true" />
      </div>
      <h2 className="text-2xl font-bold">Pay for courier pickup</h2>
      <p className="mt-2 font-semibold">Ticket #{ticketNumber}</p>
      <p className="mt-6 text-sm text-store-background-text/70">
        GIG Logistics pickup fee
      </p>
      <p className="mt-1 font-bold text-3xl">₦{amount.toLocaleString()}</p>
      <p className="mt-4 text-sm text-store-background-text/70">
        Your pickup is booked only after Paystack confirms payment. Tracking
        will then appear on your repair status page.
      </p>
      <Button asChild className="mt-8 w-full">
        <a href={authorizationUrl}>Pay securely with Paystack</a>
      </Button>
    </div>
  );
}
