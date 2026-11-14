import { useSavingsNoticeStore } from './savings-notice-store';

/** Drops the current notice, e.g. before retrying the action it described. */
export function clearSavingsNotice() {
  useSavingsNoticeStore.setState({ notice: null });
}
