import { ShieldCheck } from 'lucide-react';

export function CheckoutPageHeading() {
  return (
    <div className="flex items-center justify-between mb-8">
      <h1 className="text-2xl font-black text-gray-900 flex items-center gap-3">
        <span className="size-10 bg-store-primary text-white rounded-xl flex items-center justify-center shadow-store-primary/20 shadow-lg">
          <ShieldCheck size={20} />
        </span>
        Secure Checkout
      </h1>
      <div className="flex items-center gap-2 text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full border border-gray-100 shadow-sm">
        <div className="size-2 rounded-full bg-green-500 animate-pulse" />
        SSL Encrypted
      </div>
    </div>
  );
}
