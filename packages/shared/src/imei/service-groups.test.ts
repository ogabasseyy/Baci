import { describe, expect, it } from 'vitest';
import { groupImeiServices } from './service-groups';
import { IMEI_SERVICE_TIERS, type ImeiServiceTierKey } from './service-tiers';

describe('customer service goals', () => {
  it('assigns every stable tier to exactly one goal', () => {
    const keys = Object.keys(IMEI_SERVICE_TIERS) as ImeiServiceTierKey[];
    const grouped = groupImeiServices(keys, 'basic').flatMap((g) => g.tierKeys);
    expect(grouped.sort()).toEqual([...keys].sort());
  });

  it('groups overlapping options without dropping their distinct tiers', () => {
    const groups = groupImeiServices(
      ['basic', 'appleBasic', 'serialInfo', 'blacklist', 'blacklistPro'],
      'appleBasic'
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Device details',
      'Lost or stolen check',
    ]);
    expect(groups[0].tierKeys).toEqual(['appleBasic', 'basic', 'serialInfo']);
    expect(groups[1].tierKeys).toEqual(['blacklist', 'blacklistPro']);
  });
  it('does not add hidden tiers or duplicate supplied tiers', () => {
    expect(groupImeiServices(['pixel', 'pixel'], 'pixel')).toEqual([
      expect.objectContaining({ label: 'Device details', tierKeys: ['pixel'] }),
    ]);
  });
});
