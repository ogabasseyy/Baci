import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_JUMIA_PRODUCT_EXPORT_SELECTION_PENDING_SOURCES } from './expected-jumia-product-export-selection-pending-sources.test-fixture';
import { JUMIA_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-jumia-pending-sources';

const ROW_PATTERN = /^[0-9a-f]{64} 202\d{11}_[a-z0-9_]+\.sql$/;

describe('Jumia pending replay source rows', () => {
  it('registers the merchant-bound page migration with its frozen digest', () => {
    const filename =
      '20261023160000_jumia_product_export_selection_merchant_page.sql';
    const repositoryPath = `supabase/migrations/${filename}`;
    const sha256 = createHash('sha256')
      .update(readFileSync(resolve(process.cwd(), '../..', repositoryPath)))
      .digest('hex');

    expect(JUMIA_PENDING_REPLAY_SOURCE_ROWS.split('\n')).toContain(
      `${sha256} ${filename}`
    );
    expect(
      EXPECTED_JUMIA_PRODUCT_EXPORT_SELECTION_PENDING_SOURCES
    ).toContainEqual({
      repositoryPath,
      sha256,
    });
  });

  it('contains only valid frozen migration rows', () => {
    const rows = JUMIA_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => ROW_PATTERN.test(row))).toBe(true);
  });

  it('keeps Jumia migrations in chronological order without duplicates', () => {
    const rows = JUMIA_PENDING_REPLAY_SOURCE_ROWS.trim().split('\n');
    const versions = rows.map((row) => row.split(' ')[1].slice(0, 14));

    expect(new Set(rows).size).toBe(rows.length);
    expect(versions).toEqual([...versions].sort());
    expect(rows.at(-1)).toContain(
      '20261023160000_jumia_product_export_selection_merchant_page.sql'
    );
  });
});
