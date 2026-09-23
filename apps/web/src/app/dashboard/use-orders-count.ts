'use client';

import { useEffect, useState } from 'react';

// Module-scope helper: dynamic import() expressions are not yet supported by
// React Compiler inside component bodies, so the lazy Supabase load lives here.
async function fetchOrdersCount(merchantId: string): Promise<number> {
  const { createClient } = await import('@/lib/supabase/client');
  const supabase = createClient();
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('merchant_id', merchantId);

  if (error) {
    return 0;
  }

  return count || 0;
}

/**
 * Orders count for the sidebar badge — fetched lazily to not block the
 * initial render. This is a lightweight count query instead of full metrics.
 */
export function useOrdersCount(merchantId: string | undefined): number {
  const [ordersCount, setOrdersCount] = useState(0);

  useEffect(() => {
    let isMounted = true;

    // Only fetch if merchant exists and we're on dashboard
    // This is a lightweight call just for the badge count
    if (merchantId && ordersCount === 0) {
      // Use a simpler query just for count instead of full metrics
      fetchOrdersCount(merchantId)
        .then((count) => {
          if (isMounted) {
            setOrdersCount(count);
          }
        })
        .catch(() => {
          if (isMounted) {
            setOrdersCount(0);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [merchantId, ordersCount]);

  return ordersCount;
}
