import { useFocusEffect } from 'expo-router';

/**
 * The savings sheet is a modal: it would otherwise stay on top when another
 * screen opens over the wallet (a deep link, a notification tap). Closing it
 * on blur behaves like the customer closing it; an action already in flight
 * keeps its own held state and refreshes when it settles.
 */
export function useCloseSavingsSheetOnBlur(
  setShowSavingsProgressModal: (value: boolean) => void
) {
  useFocusEffect(() => () => setShowSavingsProgressModal(false));
}
