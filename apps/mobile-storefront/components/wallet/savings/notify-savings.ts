import {
  currentSavingsNoticeScope,
  type SavingsNoticeTone,
  useSavingsNoticeStore,
} from './savings-notice-store';

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
    notice: { title, message, tone, scope: currentSavingsNoticeScope() },
  });
}
