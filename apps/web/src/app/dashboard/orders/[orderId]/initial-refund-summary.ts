import { maskRefundWorkerText } from '@/lib/orders/mask-refund-worker-text';
import type { RefundSummary } from '@/lib/orders/refund-summary';
import { createClient } from '@/lib/supabase/server';

// Server-only initial refund summary for the order details page
// (page.tsx import graph — never import from client code). The
// panel is an interactive polling widget inside a client tree, so
// it cannot fetch as a Server Component itself; passing the first
// summary from the server removes the mount-fetch flash and the
// extra round trip, while the 30s polling still refreshes it.
// Fail-open: any failure returns null and the panel loads
// client-side exactly as before, so a status outage degrades to a
// spinner instead of breaking the order page.
export async function getInitialRefundSummary(
  orderId: string
): Promise<RefundSummary | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('manage_order_refund', {
      p_action: 'status',
      p_order_id: orderId,
    });
    if (error || !data || typeof data !== 'object') return null;
    return maskRefundWorkerText(
      data as Record<string, unknown>
    ) as unknown as RefundSummary;
  } catch {
    return null;
  }
}
