import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * The two screen events this hook uses. Both are core React Navigation
 * events on every screen; expo-router's untyped root navigation narrows its
 * event map so `beforeRemove` does not type-check without this.
 */
type LeaveEvents = {
  addListener(event: 'blur' | 'beforeRemove', listener: () => void): () => void;
};

/**
 * A wallet-only notice (such as "That savings plan has closed") explains why
 * a link opened the plain wallet. It is about that visit only, so it clears
 * when the customer leaves the wallet (another screen, a tab switch or Back)
 * instead of lingering for minutes.
 */
export function useClearWalletOnlyNoticeOnBlur(
  active: boolean,
  clear: () => void
) {
  const navigation = useNavigation() as unknown as LeaveEvents;
  const latest = useRef({ active, clear });
  latest.current = { active, clear };
  useEffect(() => {
    const leave = () => {
      if (latest.current.active) latest.current.clear();
    };
    // `blur` covers another screen opening over the wallet or a tab switch;
    // leaving by Back removes the wallet without blurring it first. Never on
    // unmount: a dev StrictMode remount would clear the note at once.
    const offBlur = navigation.addListener('blur', leave);
    const offRemove = navigation.addListener('beforeRemove', leave);
    return () => {
      offBlur();
      offRemove();
    };
  }, [navigation]);
}
