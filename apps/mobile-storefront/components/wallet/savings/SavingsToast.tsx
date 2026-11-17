import { Toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsToastStore } from './savings-toast-store';

/**
 * The wallet's brief "₦100 added to …" acknowledgement once a contribution
 * is confirmed and the savings sheet has closed. Only for the customer and
 * store it was shown for.
 */
export function SavingsToast() {
  const toast = useSavingsToastStore((state) => state.toast);
  const clear = useSavingsToastStore((state) => state.clear);
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const merchantId = useAuthStore((state) => state.merchantId ?? '');
  if (!toast || toast.scope !== `${userId}:${merchantId}`) return null;
  return (
    <Toast
      key={toast.id}
      visible
      message={toast.message}
      variant="success"
      duration={3500}
      onDismiss={clear}
    />
  );
}
