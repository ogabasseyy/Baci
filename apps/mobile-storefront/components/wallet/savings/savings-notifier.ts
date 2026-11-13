import { currentSavingsNoticeScope } from './current-savings-notice-scope';
import {
  type SavingsNoticeTone,
  useSavingsNoticeStore,
} from './savings-notice-store';

export type SavingsNotify = (
  title: string,
  message?: string,
  tone?: SavingsNoticeTone
) => void;

/**
 * A notifier bound to the customer, store and savings goal showing now. Call
 * it before any awaited work: if any of them changes before the work
 * settles, its notice is dropped instead of being shown in the wrong place.
 */
export function savingsNotifier(options?: {
  /**
   * A success outcome of this action still shows if the action itself moved
   * the sheet to another goal (a contribution that completed its goal).
   */
  successFollowsGoal?: boolean;
}): SavingsNotify {
  const scope = currentSavingsNoticeScope();
  const goalId = useSavingsNoticeStore.getState().goalId;
  return (title, message, tone = 'info') => {
    if (currentSavingsNoticeScope() !== scope) return;
    const carry = Boolean(options?.successFollowsGoal) && tone === 'success';
    if (!carry && useSavingsNoticeStore.getState().goalId !== goalId) return;
    useSavingsNoticeStore.setState({
      notice: { title, message, tone, scope, ...(carry ? { carry } : {}) },
    });
  };
}
