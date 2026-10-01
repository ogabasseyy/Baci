import { describe, expect, it } from 'vitest';
import { REPAIR_CASES } from './apply-supabase-current-tree-sources.repair-cases';

describe('applySupabaseCurrentTreeSources repair cases', () => {
  it('keeps each historical repair identity complete and unique', () => {
    expect(REPAIR_CASES).toHaveLength(12);
    expect(
      new Set(REPAIR_CASES.map(({ historicalPath }) => historicalPath)).size
    ).toBe(REPAIR_CASES.length);
    expect(
      REPAIR_CASES.every(
        ({ historicalSha256, repairPath, ordinal }) =>
          /^[a-f0-9]{64}$/.test(historicalSha256) &&
          repairPath.startsWith('supabase/migrations/') &&
          ordinal === 129
      )
    ).toBe(true);
  });
});
