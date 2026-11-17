import { create } from 'zustand';
import { currentSavingsNoticeScope } from './current-savings-notice-scope';

export type SavingsToast = {
  id: number;
  message: string;
  /** The signed-in customer and store it was shown for. */
  scope: string;
};

let nextToastId = 0;

/** A short acknowledgement on the wallet after the savings sheet closes. */
export const useSavingsToastStore = create<{
  toast: SavingsToast | null;
  clear: () => void;
}>((set) => ({
  toast: null,
  clear: () => set({ toast: null }),
}));

/**
 * A toaster bound to the customer and store signed in now. Call it before
 * any awaited work: if they change before the work settles, the toast is
 * dropped (and it returns false) instead of reaching another account.
 */
export function savingsToaster() {
  const scope = currentSavingsNoticeScope();
  return (message: string) => {
    if (currentSavingsNoticeScope() !== scope) return false;
    nextToastId += 1;
    useSavingsToastStore.setState({
      toast: { id: nextToastId, message, scope },
    });
    return true;
  };
}
