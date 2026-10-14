import type { SupabaseClient } from '@supabase/supabase-js';
import { getSafeMetadataDiagnostics } from '@/lib/vtu-metadata-fields';

const SETTLEMENT_METADATA_MERGE_ATTEMPTS = 2;

function metadataValueOf(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

/**
 * Merges settlement-owned metadata keys onto a re-read snapshot and
 * persists via compare-and-set on `updated_at` (Codex R82 P2).
 *
 * When the cron and a customer replay settle the same successful
 * transaction concurrently, both enter with independent metadata
 * snapshots. Blindly overwriting the whole column lets the loser
 * erase keys it never owned — the atomic notification claim, newly
 * persisted credit flags, token-backfill markers — and a later
 * replay then re-sends the notification. Instead this diffs the
 * keys settlement actually changed, re-reads the row, merges only
 * those keys onto fresh metadata, and CAS-writes; a lost race
 * retries once, then gives up WITHOUT throwing. Give-up is safe:
 * credit RPCs already landed idempotently (ledger-guarded), and
 * unpersisted flags re-select the row on the next cron tick.
 *
 * Additive only: settlement never deletes metadata keys, so keys
 * absent from the mutated object are left untouched.
 */
export async function mergeVtuSettlementMetadata({
  baselineMetadata,
  mutatedMetadata,
  rowId,
  supabase,
}: {
  baselineMetadata: Record<string, unknown>;
  mutatedMetadata: Record<string, unknown>;
  rowId: string;
  supabase: SupabaseClient;
}): Promise<'persisted' | 'skipped-race-lost'> {
  const ownedEntries = Object.entries(mutatedMetadata).filter(
    ([key, value]) =>
      metadataValueOf(baselineMetadata[key]) !== metadataValueOf(value)
  );
  if (ownedEntries.length === 0) {
    return 'persisted';
  }
  const ownedPatch = Object.fromEntries(ownedEntries);
  let lastCasError: string | null = null;

  for (
    let attempt = 1;
    attempt <= SETTLEMENT_METADATA_MERGE_ATTEMPTS;
    attempt += 1
  ) {
    const { data: fresh, error: rereadError } = await supabase
      .from('vtu_transactions')
      .select('metadata, updated_at')
      .eq('id', rowId)
      .maybeSingle();
    if (rereadError || !fresh) {
      console.error('Failed to re-read VTU metadata for settlement merge:', {
        error: rereadError?.message ?? 'row not found',
        transactionId: rowId,
      });
      return 'skipped-race-lost';
    }
    const freshMetadata =
      fresh.metadata && typeof fresh.metadata === 'object'
        ? (fresh.metadata as Record<string, unknown>)
        : {};
    const { data: casRow, error: casError } = await supabase
      .from('vtu_transactions')
      .update({ metadata: { ...freshMetadata, ...ownedPatch } })
      .eq('id', rowId)
      .eq('updated_at', fresh.updated_at)
      .select('id')
      .maybeSingle();
    if (casRow) {
      return 'persisted';
    }
    lastCasError = casError?.message ?? null;
  }

  console.error('VTU settlement metadata merge gave up after two attempts:', {
    error: lastCasError ?? 'CAS race lost',
    metadata: getSafeMetadataDiagnostics(ownedPatch),
    transactionId: rowId,
  });
  return 'skipped-race-lost';
}
