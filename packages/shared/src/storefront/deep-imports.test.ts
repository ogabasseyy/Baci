import { describe, expect, it } from 'vitest';
import * as barrel from './index';
import {
  LAUNCH_CAROUSEL_LIMIT,
  launchCtaLabel,
} from './launch-carousel';
import { prioritizeSmartphoneProducts } from './prioritize-smartphone-products';

describe('storefront deep imports', () => {
  it('re-export the same references as the barrel', () => {
    // The storefront barrel also re-exports zod-based modules. Client
    // bundles import these leaf modules directly (see package.json
    // ./storefront/* exports) so zod never joins their chunks; this pins
    // the deep paths to the same references the barrel exposes.
    expect(launchCtaLabel).toBe(barrel.launchCtaLabel);
    expect(LAUNCH_CAROUSEL_LIMIT).toBe(barrel.LAUNCH_CAROUSEL_LIMIT);
    expect(prioritizeSmartphoneProducts).toBe(
      barrel.prioritizeSmartphoneProducts
    );
  });
});
