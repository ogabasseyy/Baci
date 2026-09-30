import { ChevronRight, ShieldCheck } from 'lucide-react';

interface CheckoutHeaderProps {
  onReturnToCart: () => void;
}

export function CheckoutHeader({ onReturnToCart }: CheckoutHeaderProps) {
  return (
    <div className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-200/50 shadow-sm supports-[backdrop-filter]:bg-white/60">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <button
          type="button"
          aria-label="Return to Cart"
          onClick={onReturnToCart}
          className="group flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-store-primary transition-colors"
        >
          <div className="size-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-store-primary/5 transition-colors">
            <ChevronRight className="size-4 rotate-180 group-hover:text-store-primary transition-colors" />
          </div>
          <span className="max-sm:hidden sm:inline">Return to Cart</span>
        </button>

        <div className="flex flex-col items-center">
          <div className="font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-600" />
            <span>Secure Checkout</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="max-sm:hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full border border-green-100">
            <div className="size-1.5 rounded-full bg-green-500 animate-pulse" />
            Encrypted
          </div>
        </div>
      </div>
    </div>
  );
}
