import { describe, expect, it } from 'vitest';
import { isSantaCampaignVisible } from './santa-navigation';

describe('isSantaCampaignVisible', () => {
  it('shows Santa only for the configured merchant', () => {
    expect(isSantaCampaignVisible('winter-store', 'winter-store')).toBe(true);
    expect(isSantaCampaignVisible('other-store', 'winter-store')).toBe(false);
  });

  it('fails closed when no merchant is configured', () => {
    expect(isSantaCampaignVisible('winter-store', null)).toBe(false);
    expect(isSantaCampaignVisible(null, 'winter-store')).toBe(false);
  });
});
