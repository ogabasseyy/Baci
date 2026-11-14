import { useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh state that follows only the customer's own pull. Feeding a
 * background refetch into RefreshControl makes iOS show the spinner and push
 * the content down while the screen is hidden, and it can stay stuck there
 * after the tab is shown again.
 */
export function useUserPullRefresh(refetch: () => unknown): {
  onRefresh: () => Promise<void>;
  refreshing: boolean;
} {
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } catch {
      // The query shows its own error state; the spinner just stops.
    } finally {
      if (mounted.current) {
        setRefreshing(false);
      }
    }
  };
  return { onRefresh, refreshing };
}
