import { CheckCircle, Loader2 } from 'lucide-react';

export function OrderSuccessStatusIcon({
  hasValidatedOrder,
  hasRecoveryState,
}: {
  hasValidatedOrder: boolean;
  hasRecoveryState: boolean;
}) {
  return (
    <div
      className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ${
        hasValidatedOrder
          ? 'bg-green-100'
          : hasRecoveryState
            ? 'bg-amber-100'
            : 'bg-gray-100'
      }`}
    >
      {hasValidatedOrder ? (
        <CheckCircle className="size-10 text-green-600" />
      ) : (
        <Loader2
          className={`size-10 ${
            hasRecoveryState ? 'text-amber-600' : 'animate-spin text-gray-500'
          }`}
        />
      )}
    </div>
  );
}
