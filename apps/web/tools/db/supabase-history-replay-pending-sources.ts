import { ADMIN_PLATFORM_PENDING_SOURCES } from './supabase-history-replay-admin-sources';
import { ADS_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-ads-pending-sources';
import { EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-expense-pending-sources';
import { FOLLOW_UP_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-follow-up-pending-sources';
import { INVENTORY_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-inventory-pending-sources';
import { JUMIA_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-jumia-pending-sources';
import { NEGOTIATION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-negotiation-pending-sources';
import { STOREFRONT_CLUSTER_GUIDE_PENDING_SOURCES } from './supabase-history-replay-storefront-cluster-guide-pending-sources';

/**
 * Assembles pending migration rows in the deterministic order used by the
 * history-replay manifest.
 */
export function buildPendingSources(pendingSourcesHead: string): string {
  return [
    pendingSourcesHead,
    STOREFRONT_CLUSTER_GUIDE_PENDING_SOURCES,
    ADS_PENDING_REPLAY_SOURCE_ROWS,
    ADMIN_PLATFORM_PENDING_SOURCES,
    EXPENSE_QUIZ_PAYSTACK_PENDING_REPLAY_SOURCE_ROWS,
    FOLLOW_UP_PENDING_REPLAY_SOURCE_ROWS,
    INVENTORY_PENDING_REPLAY_SOURCE_ROWS,
    JUMIA_PENDING_REPLAY_SOURCE_ROWS,
    NEGOTIATION_PENDING_REPLAY_SOURCE_ROWS,
  ]
    .flatMap((sourceBlock) => sourceBlock.trim().split('\n'))
    .sort((left, right) => {
      const leftFilename = left.split(' ')[1] ?? '';
      const rightFilename = right.split(' ')[1] ?? '';
      if (leftFilename < rightFilename) {
        return -1;
      }
      if (leftFilename > rightFilename) {
        return 1;
      }
      return 0;
    })
    .join('\n');
}
