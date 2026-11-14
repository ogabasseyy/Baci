import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';

/**
 * A wallet-only notice (such as "That savings plan has closed") explains why
 * a link opened the plain wallet. It is about that visit only, so it clears
 * when the customer leaves the wallet instead of lingering for minutes.
 */
export function useClearWalletOnlyNoticeOnBlur(
  active: boolean,
  clear: () => void
) {
  const navigation = useNavigation();
  const latest = useRef({ active, clear });
  latest.current = { active, clear };
  useEffect(
    () =>
      navigation.addListener('blur', () => {
        if (latest.current.active) latest.current.clear();
      }),
    [navigation]
  );
}
