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

/** The customer and store signed in now, as a notice scope key. */
export const currentSavingsNoticeScope = () => {
  const { user, merchantId } = useAuthStore.getState();
  return `${user?.id ?? ''}:${merchantId ?? ''}`;
};

/**
 * The latest savings notice, plus the goal the savings sheet is showing:
 * a notice never carries over from one goal to another.
 */
export const useSavingsNoticeStore = create<{
  notice: SavingsNotice | null;
  goalId: string | null;
  clear: () => void;
}>((set) => ({
  notice: null,
  goalId: null,
  clear: () => set({ notice: null }),
}));
