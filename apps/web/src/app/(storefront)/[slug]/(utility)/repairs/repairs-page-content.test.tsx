import { describe, expect, it } from 'vitest';
import { shouldRenderRepairsPage } from './repairs-page-content';

describe('shouldRenderRepairsPage', () => {
  it('renders the Ogabassey repair lab even when the catalogue flag is off', () => {
    expect(
      shouldRenderRepairsPage({
        template_id: 'ogabassey',
        business_type: 'fashion',
        feature_settings: { repairs_catalog_enabled: false },
      } as Parameters<typeof shouldRenderRepairsPage>[0])
    ).toBe(true);
  });

  it('hides generic stores that have not opted into the repairs catalogue', () => {
    expect(
      shouldRenderRepairsPage({
        template_id: 'modern',
        business_type: 'fashion',
        feature_settings: { repairs_catalog_enabled: false },
      } as Parameters<typeof shouldRenderRepairsPage>[0])
    ).toBe(false);
  });
});
