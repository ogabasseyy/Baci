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
  /** Bumped each time the wallet shows; 0 while it is not on screen. */
  walletVisit: number;
  clear: () => void;
}>((set) => ({
  toast: null,
  walletVisit: 0,
  clear: () => set({ toast: null }),
}));

let visits = 0;

/** The wallet came on screen: toasts started from now on may show. */
export function walletShown() {
  visits += 1;
  useSavingsToastStore.setState({ walletVisit: visits });
}

/** The wallet left: drop any toast, and any toast still on its way. */
export function walletHidden() {
  useSavingsToastStore.setState({ walletVisit: 0, toast: null });
}

/**
 * A toaster bound to the customer and store signed in now. Call it before
 * any awaited work: if they change, or the wallet leaves the screen, before
 * the work settles, the toast is dropped (and it returns false).
 */
export function savingsToaster() {
  const scope = currentSavingsNoticeScope();
  // Only the wallet visit that started the work may show its result: one
  // that settles after the customer left is dropped, not shown next time.
  const visit = useSavingsToastStore.getState().walletVisit;
  return (message: string) => {
    if (currentSavingsNoticeScope() !== scope) return false;
    const now = useSavingsToastStore.getState().walletVisit;
    if (visit === 0 || now !== visit) return false;
    nextToastId += 1;
    useSavingsToastStore.setState({
      toast: { id: nextToastId, message, scope },
    });
    return true;
  };
}
