import { describe, expect, it } from 'vitest';
import { JUMIA_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-jumia-pending-sources';
import { buildPendingSources } from './supabase-history-replay-pending-sources';

describe('buildPendingSources', () => {
  it('sorts rows from every pending source block by migration filename', () => {
    const pending = buildPendingSources(
      'aaa 20260825000000_z.sql\nbbb 20260801000000_a.sql'
    );
    const rows = pending.split('\n');
    const filenames = rows.map((row) => row.split(' ')[1] ?? '');

    expect(filenames).toEqual([...filenames].sort());
    expect(rows).toContain('bbb 20260801000000_a.sql');
    expect(rows).toContain('aaa 20260825000000_z.sql');
    expect(pending).toContain(
      '20260821180000_provider_neutral_ads_storage.sql'
    );
  });

  it('registers the Jumia marketplace_key migration hash', () => {
    expect(JUMIA_PENDING_REPLAY_SOURCE_ROWS).toContain(
      'ba0af6a1a50a8a295cd3cfd8e143f2ae2041f3293c49ade914240715d38e90f8 20260813120100_jumia_product_mappings_marketplace_key.sql'
    );
  });
});
