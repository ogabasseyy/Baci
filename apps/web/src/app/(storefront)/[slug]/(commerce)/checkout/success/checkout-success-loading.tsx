import { Loader2 } from 'lucide-react';

export function CheckoutSuccessLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-b from-store-primary/5 via-store-background to-store-secondary p-4">
      <div className="flex items-center gap-3 text-store-background-text">
        <Loader2 className="size-5 animate-spin text-store-primary" />
        <p className="text-sm font-medium">Loading order confirmation…</p>
      </div>
    </div>
  );
}
