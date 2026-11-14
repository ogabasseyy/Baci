import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { useSavingsNoticeStore } from './savings-notice-store';

/** Drops the current notice if it is a wallet-only one. */
function clearWalletOnlyNotice() {
  if (useSavingsNoticeStore.getState().notice?.walletOnly) {
    useSavingsNoticeStore.setState({ notice: null });
  }
}

/**
 * A wallet-only notice (such as "That savings plan has closed") explains why
 * a link opened the plain wallet. It is about that visit only, so it clears
 * when the customer leaves the wallet screen: `blur` when another screen
 * opens over it or the tab changes, and unmount when it is left by Back
 * (expo-router's navigation has no `beforeRemove` event, so removal is only
 * seen as the screen unmounting). Called once, at the wallet route.
 */
export function useClearWalletOnlyNoticeOnLeave() {
  const navigation = useNavigation();
  useEffect(() => {
    const offBlur = navigation.addListener('blur', clearWalletOnlyNotice);
    return () => {
      offBlur();
      clearWalletOnlyNotice();
    };
  }, [navigation]);
}
