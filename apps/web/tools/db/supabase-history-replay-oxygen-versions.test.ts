import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { supabaseHistoryReplayManifest } from './supabase-history-replay-manifest';

it('preserves both colliding migrations under distinct versions without changing Oxygen SQL', async () => {
  const root = path.resolve(__dirname, '../../../..');
  const migrationDir = path.join(root, 'supabase/migrations');
  const names = await readdir(migrationDir);
  const inventory = '20261101150000_fix_serialized_inventory_page_cursor.sql';
  const oxygen = '20261101150001_oxygen_current_paid_activation.sql';
  expect(names).toContain(inventory);
  expect(names).toContain(oxygen);
  for (const version of ['20261101150000', '20261101150001']) {
    expect(names.filter((name) => name.startsWith(`${version}_`))).toHaveLength(
      1
    );
  }
  const sha256 = createHash('sha256')
    .update(await readFile(path.join(migrationDir, oxygen)))
    .digest('hex');
  expect(sha256).toBe(
    'ecc7e68178be986d399fb38e2782d3666ab84bcb8fdc215eae8b2366471d583f'
  );
  expect(supabaseHistoryReplayManifest.pendingSources).toContainEqual({
    repositoryPath: `supabase/migrations/${oxygen}`,
    sha256,
  });
});
