import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsNoticeStore } from './savings-notice-store';

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
    const current = useSavingsNoticeStore.getState().notice;
    // A carried success (a contribution that completed its goal) survives
    // this one switch; anything else belongs to the previous goal.
    useSavingsNoticeStore.setState(
      !previous
        ? { goalId }
        : current?.carry
          ? { goalId, notice: { ...current, carry: false } }
          : { goalId, notice: null }
    );
  }, [goalId]);
  const visible =
    notice && notice.scope === `${userId}:${merchantId}` ? notice : null;
  return { notice: visible, clear };
}
