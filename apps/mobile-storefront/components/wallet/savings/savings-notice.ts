import { create } from 'zustand';
import { useAuthStore } from '@/stores/auth-store';

export type SavingsNoticeTone = 'success' | 'info' | 'warning';

export type SavingsNotice = {
  title: string;
  message?: string;
  tone: SavingsNoticeTone;
  /** The signed-in customer and store it was shown for. */
  scope?: string;
};

const currentScope = () => {
  const { user, merchantId } = useAuthStore.getState();
  return `${user?.id ?? ''}:${merchantId ?? ''}`;
};

const useSavingsNoticeStore = create<{
  notice: SavingsNotice | null;
  clear: () => void;
}>((set) => ({ notice: null, clear: () => set({ notice: null }) }));

/**
 * Shows a calm savings outcome inside the savings sheet (or on the wallet
 * when the sheet is closed) instead of an iOS alert. The latest notice
 * replaces the previous one; the customer dismisses it.
 */
export function notifySavings(
  title: string,
  message?: string,
  tone: SavingsNoticeTone = 'info'
) {
  useSavingsNoticeStore.setState({
    notice: { title, message, tone, scope: currentScope() },
  });
}

/** Drops the current notice, e.g. before retrying the action it described. */
export function clearSavingsNotice() {
  useSavingsNoticeStore.setState({ notice: null });
}

/**
 * The latest notice, only for the customer and store it was shown for:
 * another account signing in on the same phone never sees it.
 */
export function useSavingsNotice() {
  const { notice, clear } = useSavingsNoticeStore();
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const merchantId = useAuthStore((state) => state.merchantId ?? '');
  const visible =
    notice && notice.scope === `${userId}:${merchantId}` ? notice : null;
  return { notice: visible, clear };
}
