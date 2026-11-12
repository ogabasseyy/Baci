import { useEffect, useState } from 'react';
import { MODAL_DISMISS_FALLBACK_MS } from '@/constants/modal-dismiss';

export function usePriceChangeDismissal(isPriceChangeVisible: boolean) {
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    if (isPriceChangeVisible) setIsDismissed(false);
  }, [isPriceChangeVisible]);

  useEffect(() => {
    if (isPriceChangeVisible || isDismissed) return;
    // Android may not report Modal.onDismiss; the timer releases the checkout
    // fence after the native close animation has had time to settle.
    const fallback = setTimeout(
      () => setIsDismissed(true),
      MODAL_DISMISS_FALLBACK_MS
    );
    return () => clearTimeout(fallback);
  }, [isDismissed, isPriceChangeVisible]);

  return {
    isDismissed,
    markDismissed: () => setIsDismissed(true),
  };
}
