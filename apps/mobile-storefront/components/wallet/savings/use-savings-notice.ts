import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsNoticeStore } from './savings-notice-store';

/** A success notice that still asks the customer to do something. */
function needsAction(message?: string) {
  return /pull to refresh/i.test(message ?? '');
}

/** How long a success notice stays before it clears itself. */
export const SUCCESS_NOTICE_MS = 5000;

/**
 * The latest notice, only for the customer and store it was shown for:
 * another account signing in on the same phone never sees it. Pass the goal
 * on screen: moving to another goal drops the previous goal's notice. (No
 * goal, e.g. after a cancelled goal leaves the wallet, keeps its outcome.)
 */
export function useSavingsNotice(goalId?: string | null) {
  const { notice, clear } = useSavingsNoticeStore();
  const userId = useAuthStore((state) => state.user?.id ?? '');
  const merchantId = useAuthStore((state) => state.merchantId ?? '');
  useEffect(() => {
    if (!goalId) return;
    const previous = useSavingsNoticeStore.getState().goalId;
    if (previous === goalId) return;
    useSavingsNoticeStore.setState(
      previous ? { goalId, notice: null } : { goalId }
    );
  }, [goalId]);
  const visible =
    notice && notice.scope === `${userId}:${merchantId}` ? notice : null;
  // Good news is a brief acknowledgement, not a banner that stays (owner,
  // 2026-11-17): a success notice clears itself. Warnings and pending notices
  // stay until the customer closes them.
  useEffect(() => {
    // Only pure good news expires: a success that also asks the customer to
    // pull to refresh (the wallet refresh failed) stays until closed.
    if (visible?.tone !== 'success' || needsAction(visible.message)) return;
    const timer = setTimeout(() => {
      // Only this notice: a newer one keeps its own full time.
      if (useSavingsNoticeStore.getState().notice === visible)
        useSavingsNoticeStore.setState({ notice: null });
    }, SUCCESS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [visible]);
  return { notice: visible, clear };
}
