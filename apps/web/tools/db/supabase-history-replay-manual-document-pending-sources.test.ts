import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MANUAL_DOCUMENT_PENDING_SOURCES } from './expected-manual-document-pending-sources.test-support';
import { MANUAL_DOCUMENT_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-manual-document-pending-sources';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');
const MANUAL_DOCUMENT_MIGRATIONS = [
  '20260930160000_manual_order_document_notifications.sql',
  '20260930160050_manual_order_document_claims.sql',
  '20260930160060_manual_order_document_child_invalidation.sql',
  '20260930160065_manual_order_document_merchant_rearm.sql',
  '20260930160070_manual_order_document_item_triggers.sql',
  '20260930160075_manual_order_document_domain_invalidation.sql',
  '20260930160080_customer_payment_accounts_row_id.sql',
  '20260930160085_customer_order_tax_subtotals_rpc.sql',
  '20260930160086_manual_order_document_snapshot_rpc.sql',
  '20260930160087_customer_order_transactions_payment_method.sql',
  '20260930160088_receipt_claim_activity_fallback_hashes.sql',
  '20260930160100_verified_receipt_claim_redemption.sql',
  '20260930160200_preview_receipt_claim_document_kind.sql',
  '20260930160300_enable_manual_order_document_triggers.sql',
  '20260930160350_manual_document_snapshot_builders.sql',
  '20260930160400_atomic_manual_document_dispatch.sql',
  '20260930160500_parent_first_custom_item_lock.sql',
  '20260930160600_parent_first_review_link_locks.sql',
  '20260930160700_dead_letter_corrupt_outbox_rpc.sql',
] as const;

describe('manual document pending replay sources', () => {
  it('pins every manual document source to its current bytes', async () => {
    const replayRows = MANUAL_DOCUMENT_PENDING_REPLAY_SOURCE_ROWS.split(
      '\n'
    ).map((row) => {
      const [sha256, filename, ...extra] = row.trim().split(' ');
      expect(extra).toEqual([]);
      return { sha256, filename };
    });
    const replayByFilename = new Map(
      replayRows.map(({ filename, sha256 }) => [filename, sha256])
    );
    const expectedByFilename = new Map(
      EXPECTED_MANUAL_DOCUMENT_PENDING_SOURCES.map(
        ({ repositoryPath, sha256 }) => [
          path.posix.basename(repositoryPath),
          sha256,
        ]
      )
    );

    for (const { sha256, filename } of replayRows) {
      expect(filename).toBeTruthy();
      const migration = await readFile(
        path.join(REPOSITORY_ROOT, 'supabase/migrations', filename)
      );
      expect(createHash('sha256').update(migration).digest('hex')).toBe(sha256);
    }

    for (const [filename, sha256] of expectedByFilename) {
      expect(replayByFilename.get(filename)).toBe(sha256);
    }
    expect(
      MANUAL_DOCUMENT_MIGRATIONS.every((filename) =>
        expectedByFilename.has(filename)
      )
    ).toBe(true);
  });
});
