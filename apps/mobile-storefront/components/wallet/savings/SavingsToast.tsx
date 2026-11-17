import { useEffect } from 'react';
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
  const scope = `${userId}:${merchantId}`;
  const stale = toast !== null && toast.scope !== scope;
  // A toast for another account or store is dropped, not just hidden, so it
  // can never resurface after switching back.
  useEffect(() => {
    if (stale) clear();
  }, [stale, clear]);
  if (!toast || stale) return null;
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
