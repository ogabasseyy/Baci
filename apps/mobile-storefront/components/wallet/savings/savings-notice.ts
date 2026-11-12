import { create } from 'zustand';

export type SavingsNoticeTone = 'success' | 'info' | 'warning';

export type SavingsNotice = {
  title: string;
  message?: string;
  tone: SavingsNoticeTone;
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
  useSavingsNoticeStore.setState({ notice: { title, message, tone } });
}

export function useSavingsNotice() {
  return useSavingsNoticeStore();
}
