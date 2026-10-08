import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isManualOrderSource } from './edit-order-manual-source';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');

function readManualSourcesFromMigration(relativePath: string): string[] {
  const sql = readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
  const lists = [...sql.matchAll(/\bIN\s*\(([^)]*)\)/gs)].map(
    (entry) => entry[1]
  );
  const manualList = lists.find((list) => list.includes("'manual'"));

  if (!manualList) {
    throw new Error(`No manual-source list found in ${relativePath}`);
  }

  return [...manualList.matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('edit-order manual sources', () => {
  it('matches the SQL manual-source lists', () => {
    const editSources = readManualSourcesFromMigration(
      'supabase/migrations/20261008103000_allow_admin_order_date_edit.sql'
    );
    const reviewSources = readManualSourcesFromMigration(
      'supabase/migrations/20260920160000_sync_review_transaction_date_to_document_dates.sql'
    );

    expect([...editSources].sort()).toEqual([...reviewSources].sort());

    for (const source of editSources) {
      expect(isManualOrderSource(source)).toBe(true);
    }
    for (const source of [
      'online_store',
      'storefront',
      'web',
      'MANUAL',
      '',
      null,
      undefined,
    ]) {
      expect(isManualOrderSource(source)).toBe(false);
    }
  });
});
