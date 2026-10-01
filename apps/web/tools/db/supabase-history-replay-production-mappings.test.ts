import { describe, expect, it } from 'vitest';
import { PRODUCTION_MAPPINGS } from './supabase-history-replay-production-mappings';

describe('PRODUCTION_MAPPINGS', () => {
  it('contains tab-separated production mapping rows', () => {
    const rows = PRODUCTION_MAPPINGS.split('\n').filter(Boolean);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const columns = row.split('\t');
      expect(columns).toHaveLength(4);
      expect(columns[0]).toMatch(/^\d{14}$/);
      expect(columns[1]).toMatch(/\.sql$/);
      expect(columns[2]).toMatch(/^[a-f0-9]{64}$/);
      expect(columns[3]?.length).toBeGreaterThan(0);
    }
  });
});
